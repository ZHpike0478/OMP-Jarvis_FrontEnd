'use strict';
/* Jarvis — Oh My Pi frontend bridge.
 * Spawns `omp --mode rpc` (JSONL over stdio), forwards every frame to
 * browser clients over SSE, and exposes command + CLI-passthrough endpoints.
 * Zero dependencies: Node >= 18 only. */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.HOST || '127.0.0.1';
const OMP = process.env.OMP_BIN || 'omp';
const CWD = process.env.OMP_CWD || process.cwd();
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

/* ---------- RPC child ---------- */
let child = null;
let childReady = false;
let childBuf = '';
let childSeq = 0;
let pending = new Map(); // id -> { resolve, reject, timer }
let seq = 0;
const clients = new Set(); // SSE response objects

function nextId() { return 'req_' + (++seq); }

function startOmp() {
  child = spawn(OMP, ['--mode', 'rpc', '--no-title'], {
    cwd: CWD,
    env: { ...process.env, PI_RPC_EMIT_TITLE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  childReady = false;
  childBuf = '';
  childSeq = 0;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    childBuf += chunk;
    let idx;
    while ((idx = childBuf.indexOf('\n')) >= 0) {
      const line = childBuf.slice(0, idx).trim();
      childBuf = childBuf.slice(idx + 1);
      if (!line) continue;
      handleFrame(line);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    broadcast({ type: 'rpc_stderr', text: chunk });
  });

  child.on('error', (err) => {
    broadcast({ type: 'rpc_error', error: String(err && err.message || err) });
  });

  child.on('exit', (code, signal) => {
    childReady = false;
    broadcast({ type: 'rpc_exit', code, signal });
    // Reject anything still pending.
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('omp exited (code ' + code + ')'));
    }
    pending.clear();
    // Auto-restart so the UI stays live.
    setTimeout(startOmp, 500);
  });
}

function handleFrame(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return; }
  childSeq++;
  if (obj.type === 'ready') {
    childReady = true;
    broadcast({ type: 'ready', protocolVersion: obj.protocolVersion, childSeq: childSeq });
    return;
  }
  if (obj.type === 'response') {
    const p = pending.get(obj.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(obj.id);
      if (obj.success) p.resolve(obj.data);
      else p.reject(new Error(obj.error || 'command failed'));
    }
    broadcast(obj);
    return;
  }
  // Everything else (events, ui requests, chunks, etc.) is forwarded raw.
  broadcast(obj);
}

function sendCommand(cmd) {
  return new Promise((resolve, reject) => {
    if (!child || !childReady) {
      reject(new Error('omp not ready'));
      return;
    }
    const id = cmd.id || nextId();
    const frame = { ...cmd, id };
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('command timed out: ' + cmd.type));
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify(frame) + '\n');
  });
}

function broadcast(obj) {
  const data = 'data: ' + JSON.stringify(obj) + '\n\n';
  for (const res of clients) {
    try { res.write(data); } catch { /* drop */ }
  }
}

/* ---------- CLI passthrough ---------- */
function runCli(args) {
  return new Promise((resolve) => {
    const p = spawn(OMP, args, {
      cwd: CWD,
      env: process.env,
      windowsHide: true,
    });
    let out = '';
    let err = '';
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ ok: false, error: String(e.message || e), stdout: out, stderr: err }));
    p.on('close', (code) => resolve({ ok: code === 0, code, stdout: out, stderr: err }));
  });
}

/* ---------- HTTP ---------- */
function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { json(res, 403, { error: 'forbidden' }); return; }
  fs.readFile(file, (err, data) => {
    if (err) { json(res, 404, { error: 'not found' }); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + req.headers.host);
  const p = url.pathname;

  if (p === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (p === '/api/state') {
    try {
      const data = await sendCommand({ type: 'get_state' });
      json(res, 200, { ok: true, data });
    } catch (e) { json(res, 200, { ok: false, error: e.message }); }
    return;
  }

  if (p === '/api/cmd' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { json(res, 400, { ok: false, error: 'bad json' }); return; }
    try {
      const data = await sendCommand(body);
      json(res, 200, { ok: true, data });
    } catch (e) { json(res, 200, { ok: false, error: e.message }); }
    return;
  }

  if (p === '/api/tts' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch { json(res, 400, { ok: false, error: 'bad json' }); return; }
    const text = String(body.text || '').trim();
    if (!text) { json(res, 400, { ok: false, error: 'empty text' }); return; }
    const voice = String(body.voice || 'en-US-ChristopherNeural');
    const rate = String(body.rate || '+0%');
    const tmp = path.join(os.tmpdir(), 'jarvis-tts-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.mp3');
    const args = ['-m', 'edge_tts', '-t', text, '-v', voice, '--rate', rate, '--write-media', tmp];
    const p = spawn('python', args, { windowsHide: true });
    let err = '';
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { json(res, 500, { ok: false, error: String(e.message || e) }); });
    p.on('close', (code) => {
      if (code !== 0) { json(res, 500, { ok: false, error: err.trim() || 'tts failed (code ' + code + ')' }); return; }
      fs.readFile(tmp, (e2, data) => {
        fs.unlink(tmp, () => {});
        if (e2) { json(res, 500, { ok: false, error: e2.message }); return; }
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    return;
  }

  if (p === '/api/status') {
    json(res, 200, {
      ok: true,
      omp: OMP,
      cwd: CWD,
      childReady,
      childSeq,
      clients: clients.size,
      node: process.version,
      platform: os.platform(),
    });
    return;
  }

  serveStatic(req, res, p);
});

server.listen(PORT, HOST, () => {
  console.log(`Jarvis listening on http://${HOST}:${PORT}  (omp: ${OMP}, cwd: ${CWD})`);
  startOmp();
});

process.on('SIGINT', () => { if (child) child.kill(); process.exit(0); });
process.on('SIGTERM', () => { if (child) child.kill(); process.exit(0); });
