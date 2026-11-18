---
title: Images, containers and layers
skills: [docker-images]
---

An image is a read-only package of files plus the metadata needed to start a program from them. A container is a running (or stopped) instance of an image. Almost every Docker surprise, from slow builds to lost data, comes from mixing the two up, so this lesson pins the model down before you write a Dockerfile.

## Image versus container

Think of an image as a build artefact, like the `dist/` folder of a frontend app plus the exact Node binary and system libraries that run it. It never changes once built.

A container is what you get when Docker starts a process from that artefact. Docker adds a thin writable layer on top of the image's files, so the process can create and change files without touching the image. That layer belongs to the container: `docker rm` deletes it, and a second container from the same image starts clean. Anything you want to keep must live outside the container, in a volume (lesson 3).

## Layers and the build cache

An image is a stack of layers. Each `RUN`, `COPY` or `ADD` instruction in a Dockerfile produces one layer holding the files that step added or changed. Instructions such as `ENV`, `USER` and `CMD` only change metadata.

Layers are identified by a hash of their content, which gives you two things:

- **Sharing.** Ten images built on the same base store and download that base once.
- **Caching.** When you rebuild, the builder reuses a layer if the instruction and everything before it are unchanged. For `COPY`, "unchanged" includes the content of the copied files. The first step that misses the cache forces every later step to run again.

That is why instruction order matters, the main topic of the next lesson. Deleting a file in a later layer does not shrink the image either: the file is still present in the earlier layer and is only hidden.

```sh
docker image history node:24-bookworm-slim   # one line per layer, with sizes
```

## Tags and digests

`node:24-bookworm-slim` is a repository name and a **tag**. A tag is a movable pointer, like a Git branch: the publisher re-points it whenever they release a patch. `latest` is not special, it is only the tag used when you do not write one.

A **digest** is the content hash of one exact image, like a commit SHA:

```sh
docker pull node:24-bookworm-slim
docker image inspect --format '{{index .RepoDigests 0}}' node:24-bookworm-slim
# node@sha256:…   pull or build FROM this reference to get identical bytes every time
```

Use a specific version tag for readability, and add the digest when a build must be reproducible.

## What a container actually is

A container is not a small virtual machine. It is an ordinary Linux process that the kernel has been told to isolate. **Namespaces** limit what the process can see: its own process tree (it believes it is PID 1), its own network interfaces and ports, its own filesystem root, its own hostname. **Control groups** (cgroups) limit what it can use: memory, CPU time, number of processes. There is no guest kernel, so a container starts in milliseconds and shares the host's kernel, which also means the isolation is weaker than a VM's.

## Lifecycle commands that matter

```sh
docker run -d --name web -p 127.0.0.1:8080:80 nginx:1.29-alpine  # create and start
docker ps -a                  # running and stopped containers
docker logs -f web            # stdout and stderr of the main process
docker exec -it web sh        # a second process inside the same container
docker stop web               # SIGTERM, then SIGKILL after 10 seconds
docker start web              # same container, same writable layer
docker rm web                 # delete the container and its writable layer
docker system df              # disk used by images, containers, volumes, build cache
```

`docker run` is `create` plus `start`. A stopped container still exists and still holds its name and its writable layer until you remove it; add `--rm` for throwaway containers. A container lives exactly as long as its main process: when that process exits, the container stops.

## Containers on macOS

Namespaces and cgroups are Linux kernel features, and macOS has neither. Docker Desktop, OrbStack and Colima therefore all run a small Linux VM and put your containers inside it. The `docker` command on your Mac is a client that talks to the engine in that VM. Three consequences:

- **RAM.** The VM has a memory ceiling set in the runtime's settings. Every container shares it, and a container's memory limit can never exceed it.
- **File sharing.** A bind mount of a macOS folder crosses the VM boundary through a file-sharing layer. It works, but it is slower than native disk access, which you notice with `node_modules` and file watchers. Named volumes live inside the VM and run at full speed.
- **Architecture.** On Apple silicon the VM is `arm64`. An image published only for `amd64` runs under emulation, which is slower and occasionally breaks, so prefer multi-platform images.

## Common mistakes

- Treating a container as durable. Files written inside it disappear with `docker rm`.
- Assuming `latest` means "newest". It means "whatever was last pushed without a tag", and what you have locally may be months old.
- Expecting a cleanup step such as `RUN rm -rf /tmp/build` to shrink an image when the files were added by an earlier layer.
- Leaving hundreds of stopped containers and unused images behind. Check `docker system df`, then use `docker container prune` and `docker image prune`.

## Go deeper

- [What is an image?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/): the official introduction to images and layers.
- [Understanding the image layers](https://docs.docker.com/get-started/docker-concepts/building-images/understanding-image-layers/): how layers stack and how the writable layer fits on top.
- [Docker build cache](https://docs.docker.com/build/cache/): the exact rules for when a step is reused.
- [`docker container run` reference](https://docs.docker.com/reference/cli/docker/container/run/): every flag, with examples.
- [Docker Desktop settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/): where the VM's memory, CPU and file-sharing options live.
