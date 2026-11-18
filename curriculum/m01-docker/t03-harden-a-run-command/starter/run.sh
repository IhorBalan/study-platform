#!/bin/sh
# Starts the report worker.
#
# This is how it was started "just to get it working": every privilege, the host's
# network, the Docker socket and no limits.
# TODO: replace the command below with one that meets the hardening brief.
set -eu
cd "$(dirname "$0")"

docker run -d --name report-worker \
  --privileged \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$(pwd)/config:/etc/worker" \
  registry.example.com/report-worker:2.3.1
