# shop-api

A TypeScript API that ships as a container image to `ghcr.io`. Production runs the image on Linux with Node 24; the team also tests on Node 26 ahead of the upgrade.

The workflow in `.github/workflows/ci.yml` was written in a hurry. It is slow (every pull request starts nine jobs), it has let a failing test reach `main`, and a security review flagged it.

## What I changed

TODO: one line per change, saying what was wrong and why the new version is better.
