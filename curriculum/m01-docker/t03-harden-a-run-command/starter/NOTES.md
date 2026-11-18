# Notes

TODO: for each item, one or two sentences on what it stops from happening.

- Memory, CPU and process limits:
- Dropping capabilities and `no-new-privileges`:
- Read-only root filesystem with a tmpfs:
- Non-root user:
- Removing `--privileged`, the host network and the Docker socket:

TODO: the worker now fails with `EACCES: permission denied, open '/var/cache/worker/index'`.
Which of your flags causes it, and what is the smallest change that fixes it?
