#!/usr/bin/env bash
# ===========================================================================
#  Remove the daily automatic update job registered by schedule-install.sh
# ===========================================================================
set -e
MARK="# CISTrack-Update"

if ! crontab -l 2>/dev/null | grep -qF "$MARK"; then
  echo "[INFO] No CISTrack update job found -- nothing to remove."
  exit 0
fi

crontab -l 2>/dev/null | grep -vF "$MARK" | crontab -
echo "[DONE] CISTrack update job removed. Current crontab:"
crontab -l 2>/dev/null | tail -3 || echo "  (empty)"
