#!/bin/bash
set -e
echo "=== TZer0 Bot Deploy ==="
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from template. Edit it before running."
  exit 1
fi
npm install
npm test
echo "Deploy ready. Run: node src/index.js run tasks/example.yaml"
