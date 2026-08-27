#!/usr/bin/env bash
set -euo pipefail

echo "============================================"
echo "  OMP-Jarvis - Oh My Pi + Jarvis Frontend"
echo "============================================"
echo

# ---------- 1. Check/install Bun ----------
if command -v bun >/dev/null 2>&1; then
  echo "[1/4] Bun found: $(bun --version)"
else
  echo "[1/4] Bun not found - installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# ---------- 2. Install Oh My Pi backend ----------
echo
echo "[2/4] Installing Oh My Pi backend (omp)..."
bun add --global @oh-my-pi/pi-coding-agent
export PATH="$HOME/.bun/bin:$PATH"
if ! command -v omp >/dev/null 2>&1; then
  echo "ERROR: omp not found after install. Reopen your shell and rerun."
  exit 1
fi
# ---------- 3. Install Edge TTS (voice) ----------
echo
echo "[3/5] Installing Edge TTS (voice)..."
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  PY=""
fi
if [ -z "$PY" ]; then
  echo "      WARNING: python not found - server TTS will fall back to browser speech."
  echo "      Install Python from https://python.org then rerun this script."
else
  if "$PY" -m pip install --quiet --upgrade edge-tts; then
    echo "      edge-tts installed."
  else
    echo "      WARNING: edge-tts install failed - server TTS will fall back to browser speech."
  fi
fi

# ---------- 4. Fetch Jarvis frontend ----------
echo
echo "[4/5] Fetching Jarvis frontend..."
JARVIS_DIR="${JARVIS_DIR:-$HOME/jarvis}"
if [ -d "$JARVIS_DIR" ]; then
  echo "      Existing install found at $JARVIS_DIR - updating..."
  git -C "$JARVIS_DIR" pull --ff-only || echo "      WARNING: git pull failed - keeping existing files."
else
  git clone https://github.com/ZHpike0478/OMP-Jarvis_FrontEnd.git "$JARVIS_DIR"
fi

# ---------- 5. Start ----------
echo
echo "[5/5] Starting Jarvis at http://127.0.0.1:8765"
echo "      Press Ctrl+C to stop."
echo
cd "$JARVIS_DIR"
node server.js

# ---------- 3. Fetch Jarvis frontend ----------
echo
echo "[3/4] Fetching Jarvis frontend..."
JARVIS_DIR="${JARVIS_DIR:-$HOME/jarvis}"
if [ -d "$JARVIS_DIR" ]; then
  echo "      Existing install found at $JARVIS_DIR - updating..."
  git -C "$JARVIS_DIR" pull --ff-only || echo "      WARNING: git pull failed - keeping existing files."
else
  git clone https://github.com/ZHpike0478/OMP-Jarvis_FrontEnd.git "$JARVIS_DIR"
fi

# ---------- 4. Start ----------
echo
echo "[4/4] Starting Jarvis at http://127.0.0.1:8765"
echo "      Press Ctrl+C to stop."
echo
cd "$JARVIS_DIR"
node server.js
