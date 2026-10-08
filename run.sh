#!/usr/bin/env bash
# Launch the voice-browser server. Each visitor enters their own API key in the page.
# Usage: ./run.sh [--port 8787] [--host 127.0.0.1] [--headless] [--cdp ws://...] [--start-url https://...]
#
set -euo pipefail
cd "$(dirname "$0")"
exec node src/server.js "$@"
