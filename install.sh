#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/ArmorIntel/mustela.git"
DIR="mustela"

echo "=== Mustela installer ==="
echo ""

# Check prerequisites
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is required but not installed."
  echo "Download it from https://nodejs.org/ (v18 or newer), then re-run this script."
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js v18 or newer is required (you have v$(node -v))."
  echo "Update at https://nodejs.org/"
  exit 1
fi

if ! command -v git &>/dev/null; then
  echo "Error: Git is required but not installed."
  echo "Download it from https://git-scm.com/"
  exit 1
fi

# Clone or update
if [ -d "$DIR/.git" ]; then
  echo "Found existing clone — pulling latest changes..."
  git -C "$DIR" pull --ff-only
else
  echo "Cloning Mustela..."
  git clone "$REPO" "$DIR"
fi

cd "$DIR"

echo ""
echo "Installing dependencies..."
npm ci --silent

echo "Building extension..."
npm run build --silent

DIST="$(pwd)/dist/chrome"

echo ""
echo "============================================"
echo "  Build complete!"
echo "============================================"
echo ""
echo "Load the extension in Chrome:"
echo ""
echo "  1. Open this URL in Chrome:  chrome://extensions"
echo "  2. Enable  Developer mode    (toggle, top-right corner)"
echo "  3. Click   Load unpacked"
echo "  4. Select this folder:"
echo ""
echo "     $DIST"
echo ""
echo "The Mustela icon will appear in your toolbar."
echo "Right-click it → Options to add your provider API keys."
echo ""
