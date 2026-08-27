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
echo "      omp version: $(omp --version)"

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
