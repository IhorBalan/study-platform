# Notes

- **Memory, CPU and process limits.** A leak or a runaway job can no longer starve the other
  containers or the Docker VM. Past 256 MiB the kernel kills the worker (exit code 137)
  instead of the machine swapping; `--cpus 0.5` throttles it to half a core; `--pids-limit`
  stops a fork bomb or an unbounded child-process pool.
- **Dropping capabilities and `no-new-privileges`.** Capabilities are the pieces of root's
  power (changing file ownership, raw sockets, binding low ports and so on). The worker
  needs none, so a compromised process has none to abuse. `no-new-privileges` stops it
  regaining them by executing a setuid binary that happens to be in the image.
- **Read-only root filesystem with a tmpfs.** An attacker cannot modify the application
  code or drop a binary into the image's filesystem, and the container cannot fill the disk
  through its writable layer. `/tmp` is the one writable place, lives in memory and is
  gone when the container stops.
- **Non-root user.** Even without capabilities, UID 0 owns most files in the image and is
  what a container escape would arrive as on the host kernel. UID 10001 owns nothing.
- **Removing `--privileged`, the host network and the Docker socket.** `--privileged` gives
  every capability and device access. The host network removes network isolation, so the
  worker could reach anything listening on the VM's loopback. The Docker socket lets the
  process start a new privileged container, which is root on the host with extra steps.

**The `EACCES` error.** `--read-only` causes it: `/var/cache/worker` is on the image's root
filesystem, which is now immutable (and UID 10001 would not own it anyway). The smallest fix
is a second tmpfs for exactly that path, `--tmpfs /var/cache/worker`, or a named volume if
the cache should survive restarts. Removing `--read-only` would fix it too and give up the
protection for the whole filesystem.
