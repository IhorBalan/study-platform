---
title: Building and publishing images in CI
skills: [ci-container-images]
---

Module 1 taught you to write a small, cacheable Dockerfile. In CI the same Dockerfile meets new problems: the machine is fresh every time, so the layer cache is gone; images must be named so that a deploy points at exactly one build; and the registry needs credentials that should not live in a developer's head. This lesson covers building once per commit, naming images by tag and digest, keeping builds fast, and a short look at provenance and scanning.

## The Dockerfile, briefly

A multi-stage build compiles in one stage and copies only what runs into a slim final stage:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
CMD ["node", "dist/main.js"]
```

The lockfile is copied before the source, so the install layer is reused until dependencies change. The final image has no compiler, no dev dependencies and no source, and it runs as a non-root user. `CMD` uses the exec form, so Node is PID 1 and receives `SIGTERM` directly; lesson 4 depends on that.

## Tags and digests

A **tag** such as `ghcr.io/acme/shop-api:main` is a name that points at an image. Anyone with push access can point it somewhere else, and the next `docker pull` gets different bytes. A **digest** such as `sha256:4f1c…` is the hash of the image manifest. It names content, so it can never change.

Use both, for different jobs:

- **Tag every build with the commit SHA.** `shop-api:3f9c2a1…` tells you exactly which code is inside, and you can always go back to it. Never overwrite a SHA tag.
- **Add moving tags for people**: `main`, `staging`, or a release version. They are convenient, not authoritative.
- **Deploy by digest or by SHA tag**, never by `latest`. "Roll back to `latest`" means nothing once `latest` has moved, and two machines pulling `latest` minutes apart can run different code.

```sh
docker buildx imagetools inspect ghcr.io/acme/shop-api:main   # shows the digest behind a tag
docker pull ghcr.io/acme/shop-api@sha256:4f1c...             # pull by content
```

## Registries

A registry stores images. For a GitHub project, the GitHub Container Registry (`ghcr.io`) is the least friction: a workflow can push with its own `GITHUB_TOKEN` when the job has `packages: write`. AWS ECR, Google Artifact Registry and Docker Hub work the same way with their own login. PaaS platforms such as Fly have their own registry, and can also deploy an image you push elsewhere.

Image names in `ghcr.io` must be lowercase. `${{ github.repository }}` keeps the owner's capitalisation, which breaks for `Acme/Shop-API`; `docker/metadata-action` lowercases names for you.

## Build once, promote the same image

Build the image **once per commit on `main`**. Deploy that image to staging, test it, and promote **the same digest** to production. Do not rebuild for each environment: a rebuild can pull a newer base image or package and produce different bytes from the ones you tested. Everything that differs between environments comes from configuration at run time (lesson 5).

On pull requests, build the image without pushing it. That catches a broken Dockerfile before merge without filling the registry with throwaway images, and fork pull requests could not push anyway.

## The image job

```yaml
image:
  needs: verify
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    - uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
    - uses: docker/login-action@8aa5831fb8d48d8f76594c7ddde61ae58019f550 # v4.8.0
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}
    - id: meta
      uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
      with:
        images: ghcr.io/${{ github.repository }}
        tags: |
          type=sha,format=long
          type=ref,event=branch
    - id: build
      uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
      with:
        context: .
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
    - run: echo "pushed digest $DIGEST"
      env:
        DIGEST: ${{ steps.build.outputs.digest }}
```

`setup-buildx-action` gives you BuildKit with its cache exporters. `metadata-action` turns the commit and branch into tags (`sha-3f9c2a1…` and `main`) and adds OCI labels such as the source repository and revision. `build-push-action` builds, pushes, and outputs the **digest**, which is what a later deploy step should use.

The job runs only for pushes to `main`, because it holds `packages: write`. For pull requests, add a second job without that permission that runs the same `build-push-action` step with `push: false` and the same cache settings.

## Keeping builds fast

A hosted runner starts with an empty Docker cache, so without help every layer is rebuilt, including the slow `pnpm install`. BuildKit can export its cache and import it on the next run:

- `type=gha` stores it in the GitHub Actions cache. Simple, scoped to the repository, subject to the Actions cache size limit.
- `type=registry,ref=ghcr.io/acme/shop-api:buildcache` stores it as an image in your registry. Works across CI systems and survives cache eviction.
- `mode=max` exports the layers of every stage, including the `build` stage. The default `min` exports only the final image's layers, so the expensive install in the build stage would not be cached.

The cache only helps if the Dockerfile is ordered for it, which is why the lockfile is copied before the source. Building for several CPU architectures (`platforms: linux/amd64,linux/arm64`) multiplies build time, especially under emulation; do it only if something actually runs on ARM.

## Provenance and scanning, in brief

Two questions come up once images reach production: where did this image come from, and what is inside it?

**Provenance** is a signed record of how an image was built: which repository, which commit, which workflow. `build-push-action` attaches a provenance attestation by default (`mode=min` in private repositories, `mode=max` in public ones); set `provenance: mode=max` to record more. `sbom: true` attaches a software bill of materials, the list of packages in the image. Together they let you answer "is this the image our CI built?" and "which images contain the vulnerable library?".

**Scanning** compares the packages in an image against vulnerability databases. Tools such as Trivy, Grype and Docker Scout run as a CI step. Two habits make scanning useful rather than noisy:

- Fail the build only on serious findings that have a fix available. A wall of unfixable low-severity issues trains people to ignore the step.
- Rescan images that are already deployed on a schedule. New vulnerabilities are published for old images every day, and a slim base image (`node:24-slim` or a distroless image) simply has fewer packages to be vulnerable.

## Common mistakes

- Deploying `latest`, so nobody can say which code runs or roll back to a known version.
- Rebuilding the image per environment instead of promoting one digest.
- Pushing images from pull requests, or giving the PR job `packages: write`.
- A personal access token stored as a secret for the registry login, when the job's own `GITHUB_TOKEN` works and expires with the job.
- Copying the whole source before installing dependencies, which defeats the layer cache in CI just as on a laptop.
- `cache-to` without `mode=max` in a multi-stage build, then wondering why the install step never hits the cache.

## Go deeper

- [Docker Build GitHub Actions](https://docs.docker.com/build/ci/github-actions/): the official actions and their examples.
- [Cache management with GitHub Actions](https://docs.docker.com/build/ci/github-actions/cache/): the `gha` and `registry` cache backends.
- [SBOM and provenance attestations with GitHub Actions](https://docs.docker.com/build/ci/github-actions/attestations/): what is attached by default and how to add more.
- [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry): pushing to `ghcr.io` with the workflow token.
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/): the Dockerfile side, as a recap of module 1.
