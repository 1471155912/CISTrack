#!/usr/bin/env bash
# ===========================================================================
#  CISTrack one-click update (macOS / Linux)
#    pull latest orbital elements -> rebuild bundled data -> repackage the
#    single-file HTML -> sync the versioned snapshot.
#
#  Usage:   ./deploy/update.sh          (or:  bash deploy/update.sh)
#  Requirements: Node.js 18+ (https://nodejs.org/). No npm install needed:
#    the build chain has zero npm dependencies.
#
#  If a step fails (most often refresh.mjs when you are offline), that is OK:
#    just open the existing CISTrack.html -- it carries bundled data and also
#    tries to update itself online at runtime.
# ===========================================================================
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found."
  echo "        Please install Node.js 18 or newer from https://nodejs.org/ and run this again."
  exit 1
fi

echo "==> 1/4  Fetching the latest orbital elements  (refresh.mjs)"
node refresh.mjs
echo "==> 2/4  Rebuilding the bundled data           (mkdata.mjs)"
node mkdata.mjs
echo "==> 3/4  Repackaging the single-file HTML      (build.mjs)"
node build.mjs
echo "==> 4/4  Syncing the versioned snapshot        (release.mjs)"
node release.mjs

echo
echo "[DONE] CISTrack.html is up to date -- open it in your browser."
