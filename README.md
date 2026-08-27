# OMP-Jarvis_FrontEnd

A Jarvis-style web frontend for [Oh My Pi](https://github.com/oh-my-pi) (`omp`), shipped as a unified installation package that sets up **both** the Oh My Pi backend and the Jarvis frontend in one step.

![UI](https://img.shields.io/badge/UI-Jarvis%20HUD-00e5ff) ![Backend](https://img.shields.io/badge/backend-omp--rpc-3ddc97) ![Deps](https://img.shields.io/badge/deps-zero-5f7a92)

---

## What the installation package includes

The package is a single repo containing everything needed to run a full Oh My Pi coding agent from your browser:

| Component | File(s) | What it does |
|---|---|---|
| **Unified installer (Windows)** | `install.bat` | Installs Bun, installs the Oh My Pi backend (`omp`), clones the frontend, starts the server |
| **Unified installer (macOS/Linux)** | `install.sh` | Same flow for Unix shells |
| **Backend bridge** | `server.js` | Spawns `omp --mode rpc` and bridges the full agent protocol to the browser over SSE |
| **Jarvis frontend** | `public/index.html`, `public/style.css`, `public/app.js` | The browser UI: chat, tool activity, todos, CLI panel, system status |
| **Package manifest** | `package.json` | `npm start` entry point; zero runtime dependencies |
| **Documentation** | `README.md` | This file |

### 1. The backend (Oh My Pi)

The installer pulls the official Oh My Pi package:

```sh
bun add --global @oh-my-pi/pi-coding-agent
```

This provides the `omp` CLI — the full coding agent: model routing, tool execution, session management, slash commands, subcommands (`models`, `stats`, `usage`, `share`, …), and the RPC protocol the frontend talks to.

### 2. The bridge (`server.js`)

A zero-dependency Node server that:

- Spawns `omp --mode rpc --no-title` (the JSONL-over-stdio protocol)
- Forwards every frame (streaming text, thinking, tool calls, todos, model changes) to browser clients over **SSE**
- Exposes `/api/cmd` — proxies any RPC command (`prompt`, `abort`, `set_model`, `set_thinking_level`, `compact`, `bash`, …), so the **full CLI surface is reachable from the UI**
- Exposes `/api/tts` — synthesizes speech via the `edge-tts` Python package (Microsoft Edge neural voices) and returns MP3 audio, for exact voice/rate control beyond the browser's built-in `speechSynthesis`
- Auto-restarts the `omp` child if it crashes

### 3. The frontend (Jarvis HUD)

A dark glass interface with a cyan core, grid backdrop, and monospace chrome:

- **Voice input (STT)** — 🎤 mic button uses the browser's Web Speech API (Microsoft speech service in Edge/Chrome) to transcribe your directive into the composer
- **Spoken replies (TTS)** — 🔊 toggle speaks the assistant's final answer using Edge neural voices via the server-side `/api/tts` endpoint (`edge-tts`), with automatic fallback to the browser's built-in `speechSynthesis`; a voice selector offers 10 Edge neural voices
- **Tools panel** — live tool-execution cards with arguments and results
- **Tools panel** — live tool-execution cards with arguments and results
- **Todos** — the agent's plan phases/tasks rendered from `get_state`
- **CLI panel** — run any `omp` subcommand with output in the panel
- **System panel** — model, thinking level, context usage, session, queue modes
- **Clickable pills** — cycle model and thinking level
- **Status dot** — green idle / amber streaming / red disconnected

---

- **Python 3.8+** (optional — enables server-side Edge TTS; without it, spoken replies fall back to the browser's built-in speech)

## Install & run

### Windows

```bat
curl -fsSL -o install.bat https://raw.githubusercontent.com/ZHpike0478/OMP-Jarvis_FrontEnd/main/install.bat
install.bat
```

### macOS / Linux

```sh
curl -fsSL -o install.sh https://raw.githubusercontent.com/ZHpike0478/OMP-Jarvis_FrontEnd/main/install.sh
chmod +x install.sh
./install.sh
```

3. Installs **Edge TTS** (`pip install edge-tts`) for server-side voice synthesis — skipped with a warning if Python is missing (TTS then falls back to the browser's built-in speech)
4. Clones this repo to `~/jarvis` (or `%USERPROFILE%\jarvis` on Windows) — updates in place on re-run
5. Starts the server
3. Clones this repo to `~/jarvis` (or `%USERPROFILE%\jarvis` on Windows) — updates in place on re-run
4. Starts the server

Then open **http://127.0.0.1:8765**.

### Manual start

```sh
cd ~/jarvis        # or wherever you cloned it
node server.js     # or: npm start
```

## Configuration

Environment variables (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8765` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address |
| `OMP_BIN` | `omp` | Path to the omp binary |
| `OMP_CWD` | server cwd | Working directory for the omp session |

## How it works

```
Browser (SSE)  <->  server.js  <->  omp --mode rpc (stdio JSONL)
                        |
                        +-- /api/tts  (edge-tts MP3 synthesis)
                        +-- /api/state (get_state)
```

Zero runtime dependencies — plain Node `http`, `child_process`, and `fs`.

## Security

- Binds to `127.0.0.1` only by default. Set `HOST=0.0.0.0` only if you understand the exposure: the server can run arbitrary `omp` commands and read your model credentials.
- No authentication is built in. Do not expose it publicly without a reverse proxy + auth.
