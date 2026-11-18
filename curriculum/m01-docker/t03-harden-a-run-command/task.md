A teammate started the report worker with every privilege Docker offers, "just to get it working". The worker reads jobs from a queue over the network, reads its settings from `/etc/worker`, writes scratch files to `/tmp`, and needs nothing else. Rewrite the command so that the container gets exactly that.

## Requirements

Edit `run.sh` so that it contains **one** `docker run` command (other lines such as `set -eu` or `cd` are fine) for the image `registry.example.com/report-worker:2.3.1`. The image name must be the last word of the command.

| What | Value |
| --- | --- |
| Mode and name | detached, named `report-worker` |
| Memory limit | 256 MiB |
| CPU limit | half a core |
| Process limit | 100 |
| Capabilities | drop all, add none |
| Privilege escalation | blocked with the `no-new-privileges` security option |
| Root filesystem | read-only, with a tmpfs mounted at `/tmp` |
| User | UID `10001`, GID `10001` |
| Network | the user-defined network `reports-net`, no published ports |
| Settings | the `config` folder next to `run.sh`, bind-mounted read-only at `/etc/worker` |

Remove `--privileged`, the host network and the Docker socket mount. Then fill in `NOTES.md`.

## What is checked

The image does not exist, so nothing is run. The checks read `run.sh`, join backslash line continuations, split the command into words the way a shell would (single quotes, double quotes and `$(…)` are understood) and look at the options before the image name. For each row of the table they expect the option and its value. Both `--option value` and `--option=value` are accepted, as are the short forms `-m`, `-u` and `-v` and the `--mount` syntax.

The review then reads `NOTES.md`.

To try the flags for real, swap in an image you have, for example:

```sh
docker network create reports-net
# in run.sh, temporarily: … postgres:18-alpine sleep 300
docker exec report-worker sh -c 'id; touch /x; touch /tmp/x'
```
