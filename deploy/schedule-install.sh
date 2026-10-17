#!/usr/bin/env bash
# ===========================================================================
#  Register a daily automatic update in cron (macOS / Linux).
#  Runs deploy/update.sh every day at 06:00 local time.
#
#  Usage:    ./deploy/schedule-install.sh
#  Remove:   ./deploy/schedule-remove.sh
#  Inspect:  crontab -l
# ===========================================================================
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found. Install Node.js 18+ first, then run this again."
  exit 1
fi
if ! command -v crontab >/dev/null 2>&1; then
  echo "[ERROR] crontab was not found. On minimal images install cron first"
  echo "        (Debian/Ubuntu: apt-get install cron; Alpine: apk add dcron)."
  exit 1
fi

HERE="$(pwd)/deploy/update.sh"
MARK="# CISTrack-Update"
LINE="0 6 * * * cd $(pwd) && bash $HERE >> $(pwd)/deploy/update.log 2>&1 $MARK"

if crontab -l 2>/dev/null | grep -qF "$MARK"; then
  echo "[INFO] A CISTrack update job is already registered:"
  crontab -l | grep -F "$MARK"
  echo "        Run deploy/schedule-remove.sh first if you want to change it."
  exit 0
fi

( crontab -l 2>/dev/null; echo "$LINE" ) | crontab -
echo "[DONE] Registered a daily 06:00 update job. Current crontab:"
crontab -l | tail -3
echo "        Remove it later with  deploy/schedule-remove.sh"
