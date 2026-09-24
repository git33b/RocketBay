#!/usr/bin/env bash
# Print RocketBay friend-trial feedback entries (newest first).
# One-time setup: npm i -g firebase-tools && firebase login
# Usage: scripts/read-feedback.sh [limit] [--json]
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/read-feedback.js" "$@"
