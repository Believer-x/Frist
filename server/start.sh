#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -r server/requirements.txt
exec .venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
