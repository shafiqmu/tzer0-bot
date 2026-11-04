#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install
fi
unset PRIVATE_KEYS_JSON
node src/index.js run tasks/e2e-t0.yaml
