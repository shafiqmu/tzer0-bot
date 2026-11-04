#!/bin/bash
set -e

echo "=== TZer0 Bot Termux Setup ==="

# Install Node.js jika belum ada
if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js..."
  pkg install -y nodejs
fi

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# Install dependencies
echo "Installing dependencies..."
npm install

# Setup termux-wake-lock
if ! command -v termux-wake-lock >/dev/null 2>&1; then
  echo "Installing termux-api..."
  pkg install -y termux-api
fi

echo "Enabling wake lock..."
termux-wake-lock on 2>/dev/null || echo "Wake lock requires manual enable in Termux: termux-wake-lock"

# Setup battery optimization
echo "Disable battery optimization for Termux app to keep bot running."
echo "Settings > Apps > Termux > Battery > Unrestricted"

echo ""
echo "=== Setup Complete ==="
echo "1. Edit .env with your private key or TEST_WALLET_FILE"
echo "2. Run: node src/index.js run tasks/e2e-t0.yaml"
echo "3. Keep Termux open or use termux-wake-lock"
echo ""
echo "To stop wake lock: termux-wake-unlock"
