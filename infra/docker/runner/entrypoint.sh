#!/bin/sh
# Runs a task's check suite against a submission. Everything here is inside the
# sandbox: no internet, read-only root filesystem, and only /work, /tmp and
# /results are writable.
set -eu

# The submission is mounted read-only. Checks compile and run it, so work on a copy.
cp -R /submission/. /work/
cd /work

# Runner images with pre-installed packages expose them to the submission here.
if [ -d /opt/runner/node_modules ]; then
  ln -s /opt/runner/node_modules /work/node_modules
fi

export SUBMISSION_DIR=/work
export HOME=/tmp
export NODE_ENV=test

# Node resolves the glob itself; a bare directory argument is not accepted.
exec node --test \
  --test-reporter=/opt/runner/reporter.mjs --test-reporter-destination=/results/results.jsonl \
  --test-reporter=spec --test-reporter-destination=stdout \
  "/checks/**/*.test.mjs"
