#!/bin/bash
set -euo pipefail

# Only run inside Claude Code on the web sandbox; locally users have their own setup.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v railway >/dev/null 2>&1; then
  npm install -g @railway/cli >/dev/null
fi

railway --version
