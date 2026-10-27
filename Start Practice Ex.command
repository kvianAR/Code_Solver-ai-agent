#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null; then
  echo "Install Node.js 22 or newer, then open this file again."
  read -r "?Press Return to close."
  exit 1
fi
node scripts/setup.mjs
read -r "?Press Return to close. Practice Ex. keeps running in the background."
