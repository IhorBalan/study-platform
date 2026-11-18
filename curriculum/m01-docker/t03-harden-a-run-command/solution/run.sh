#!/bin/sh
# Starts the report worker with limits and the least privilege it needs.
# Requires the network once: docker network create reports-net
set -eu
cd "$(dirname "$0")"

docker run -d --name report-worker \
  --memory 256m \
  --cpus 0.5 \
  --pids-limit 100 \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp \
  --user 10001:10001 \
  --network reports-net \
  -v "$(pwd)/config:/etc/worker:ro" \
  registry.example.com/report-worker:2.3.1
