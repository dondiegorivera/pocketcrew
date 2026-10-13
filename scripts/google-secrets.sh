#!/usr/bin/env bash
# Only the Google OAuth client's id and secret: scripts/secrets.sh asks for nothing else with --google.
exec "$(dirname "$0")/secrets.sh" --google
