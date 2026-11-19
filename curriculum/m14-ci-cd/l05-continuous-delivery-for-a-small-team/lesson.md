---
title: Continuous delivery for a small team
skills: [continuous-delivery]
---

Continuous delivery means every commit on `main` is a release candidate that has passed the pipeline and can go to production with one action. Continuous deployment goes one step further: that action is automatic. For a team of two to ten people, the goal is not a perfect platform; it is that shipping is so routine that small changes go out daily and a bad one is undone in minutes. This lesson covers environments, preview deploys, configuration per environment, a worked example on a PaaS, and what to automate first.

## Environments and what each one is for

An **environment** is a running copy of the system with its own configuration, data and secrets. Each one should answer a question the others cannot:

| Environment | Question it answers | Data |
| --- | --- | --- |
| Local | Does my change work at all? | Seed data, Docker Compose |
| CI | Does it pass the checks on a clean machine? | Throwaway, per run |
| Preview (per pull request) | Does it work deployed, and can a reviewer click through it? | Seeded, per preview |
| Staging | Does this exact image work against production-like infrastructure? | Realistic but not real |
| Production | Real users | Real |

A small team can drop environments as long as each question is still answered somewhere. Many teams skip staging once they have preview deploys, a canary step and good rollback. What you must not do is let staging become a place where people deploy by hand and "test a bit"; then it differs from production in ways nobody knows.

## One image, configuration per environment

The image from lesson 3 is built once and deployed everywhere. Everything that differs comes from the environment at run time: database URL, API keys, log level, feature flag defaults. This is the twelve-factor rule from module 2, and the zod-validated config there is what makes it safe: an environment with a missing variable fails at start-up, before the readiness check passes, so the rollout stops instead of serving errors.

Where the values live:

- **Non-secret config** (log level, public URLs): platform variables, or `vars` in GitHub environments.
- **Secrets**: the platform's secret store, or GitHub environment secrets that only jobs for that environment can read. Never in the image, never in the repository.
- **Cloud credentials for deploy jobs**: prefer short-lived tokens. GitHub Actions can exchange its OIDC token for cloud credentials (modules 11 and 15), so no long-lived access key is stored anywhere.

## GitHub environments as the deploy gate

A job that names an environment gets that environment's secrets and is subject to its protection rules:

```yaml
deploy-production:
  needs: [build, deploy-staging]
  runs-on: ubuntu-latest
  environment: production
  concurrency:
    group: deploy-production
    cancel-in-progress: false # queue deploys, never cancel one halfway
  steps:
    - run: ./scripts/deploy.sh "$IMAGE"
      env:
        IMAGE: ghcr.io/acme/shop-api@${{ needs.build.outputs.digest }}
        DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

Protection rules on the `production` environment can require a reviewer to approve, add a wait timer, and restrict which branches may deploy. Secrets are released to the job only after approval. Note `cancel-in-progress: false`: cancelling CI runs is good, cancelling a deploy halfway through a migration is not.

## Preview deploys

A preview deploy is a short-lived copy of the app for one pull request, with its own URL. You know them from Vercel; backends can have them too. They catch the problems that only show up when the app is actually deployed (missing environment variables, a start command that fails, a migration that does not run on an empty database) and let a reviewer or a product manager try the change.

They cost something, so decide three things up front:

- **Data**: each preview gets an empty database plus seed data, or a branch of a staging database if your provider supports branching. Never production data.
- **Secrets**: previews use test-mode keys (Stripe test mode, a sandbox email provider). Fork pull requests get no secrets, so they get no preview.
- **Cleanup**: delete the preview when the pull request closes, or the bill and the list of stray databases grow every week.

## Deploying to a PaaS (optional)

This section is optional and needs an account with Fly.io or Railway; both offer a trial for new accounts, so check their current pricing. It is worth doing once, because it shows how much of this module a platform does for you.

### Fly.io

Fly runs your Docker image on small VMs. `fly launch` creates a `fly.toml`; the parts that matter for this module are:

```toml
app = "shop-api"
primary_region = "ams"
kill_signal = "SIGTERM"
kill_timeout = 30

[deploy]
  release_command = "node dist/migrate.js"
  strategy = "rolling"

[http_service]
  internal_port = 3000
  force_https = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "10s"
    interval = "15s"
    timeout = "2s"
    method = "GET"
    path = "/healthz/ready"
```

`release_command` runs your migrations in a temporary machine with the new image, and a non-zero exit stops the deploy. The health check gates the rolling replacement. `kill_signal` and `kill_timeout` match your graceful shutdown; Fly's defaults are `SIGINT` and 5 seconds. Other strategies are `bluegreen`, `canary` and `immediate`.

Deploying from CI needs a deploy token (`fly tokens create deploy`) stored as a secret:

```yaml
deploy:
  needs: build # the image job of lesson 3, with `outputs: digest`
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  environment: production
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    - uses: superfly/flyctl-actions/setup-flyctl@ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1 # v1.6
    - run: flyctl deploy --image "ghcr.io/acme/shop-api@$DIGEST"
      env:
        DIGEST: ${{ needs.build.outputs.digest }}
        FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

`--image` deploys the image CI already built and tested, by digest, which keeps the "build once" rule of lesson 3. The shorter `flyctl deploy --remote-only` builds again on Fly's builder from the checked-out source. That is fine for a first deploy, but what runs in production is then not the image your tests ran against. For the digest to reach this job, the build job declares it as a job output: `outputs: { digest: ${{ steps.build.outputs.digest }} }`. Fly also has to be able to pull the image. A public package works as it is; for a private one, the simplest route is to push the same image to Fly's own registry as well (`flyctl auth docker`, then tag and push it as `registry.fly.io/<app>`) and deploy that reference.

To roll back, list earlier images with `fly releases --image` and deploy one again with `fly deploy --image <image>`. Like every image rollback, it does not touch the database.

### Railway

Railway builds from your repository or deploys an image, and is configured mostly in its dashboard. The equivalents are a **pre-deploy command** for migrations (a failure stops the deployment), a **healthcheck path** that a new deployment must pass before it receives traffic, **PR environments** for preview deploys, and a rollback button on earlier deployments. One default to change: the old deployment gets `SIGTERM` and is killed after 0 seconds unless you set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, so a graceful shutdown has no time to run.

## What to automate first

Automate in the order that removes the most risk per hour spent:

1. **CI on every pull request, with required checks.** Nothing else matters if `main` can be red.
2. **An image per commit on `main`, tagged with the SHA.** Now every deploy and rollback has a precise target.
3. **A one-command deploy of a given image, and a one-command rollback.** Even if a human starts it, it must be the same steps every time. Write the rollback down and try it once on a quiet day.
4. **Migrations as a pipeline step that blocks the deploy on failure.**
5. **Automatic deploy of `main` to staging (or straight to production behind a canary), with a smoke test after it.**
6. **Preview deploys,** once the team reviews enough changes that clicking through them pays off.

Measure whether it is working with the DORA metrics: how long a commit takes to reach production, how often you deploy, how often a deploy causes a failure, and how long recovery takes. A small team with good habits can deploy many times a day with recovery measured in minutes.

## Common mistakes

- Different images per environment, or settings baked into the image, so staging proves little about production.
- Secrets copied into CI as long-lived keys when the platform or cloud supports short-lived tokens.
- A deploy job with `cancel-in-progress: true`, which can stop a release halfway.
- Preview environments with production data, or that are never deleted.
- A rollback that has never been tried.
- Automating previews and dashboards before CI is required and deploys are repeatable.

## Go deeper

- [Deployments and environments (GitHub Docs)](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments): protection rules, environment secrets and deployment branches.
- [The Twelve-Factor App: Config](https://12factor.net/config): why configuration lives in the environment.
- [Fly.io app configuration](https://docs.fly.io/reference/configuration): `release_command`, deploy strategies, checks and kill settings.
- [Railway deployments reference](https://docs.railway.com/deployments/reference): healthchecks, rollbacks, overlap and draining.
- [DORA software delivery metrics](https://dora.dev/guides/dora-metrics/): how to tell whether your delivery is getting better.
