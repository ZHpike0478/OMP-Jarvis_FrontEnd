'use strict';
/* Jarvis client — talks to the bridge server over SSE + fetch. */

const $ = (id) => document.getElementById(id);
const chatLog = $('chat-log');
const chatInput = $('chat-input');
const toolList = $('tool-list');
const todoList = $('todo-list');
const cliInput = $('cli-input');
const cliOutput = $('cli-output');
const cliCommands = $('cli-commands');
const sysKv = $('sys-kv');

const state = {
  connected: false,
  streaming: false,
  model: '—',
  thinking: '—',
  session: '—',
  fast: false,
  commands: [],
  tools: [],          // active tool cards
  assistantEl: null,  // current assistant message element
  assistantBlocks: [], // content blocks of current assistant message
  toolSeq: 0,
};

/* ---------- helpers ---------- */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtTime() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function scrollChat() { chatLog.scrollTop = chatLog.scrollHeight; }

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

/* ---------- chat rendering ---------- */
function addMessage(role, text) {
  const wrap = el('div', 'msg ' + role);
  const who = el('div', 'who', role === 'user' ? 'YOU' : role === 'assistant' ? 'JARVIS' : role.toUpperCase());
  who.appendChild(el('span', 'muted', fmtTime()));
  const body = el('div', 'body');
  if (text) body.textContent = text;
  wrap.appendChild(who);
  wrap.appendChild(body);
  chatLog.appendChild(wrap);
  scrollChat();
  return { wrap, body };
}

function renderAssistant() {
  if (!state.assistantEl) {
    const m = addMessage('assistant', '');
    state.assistantEl = m;
  }
  const body = state.assistantEl.body;
  body.innerHTML = '';
  for (const block of state.assistantBlocks) {
    if (block.type === 'text') {
      const pre = el('div');
      pre.textContent = block.text || '…';
      body.appendChild(pre);
    } else if (block.type === 'thinking') {
      const th = el('div', 'thinking', (block.text || '').trim() ? '◈ ' + block.text : '◈ thinking…');
      body.appendChild(th);
    } else if (block.type === 'tool_use') {
      const card = el('div', 'tool-card');
      card.innerHTML = '<span class="t-name">' + esc(block.name) + '</span> ' +
        '<span class="t-args">' + esc(block.input || '…') + '</span>';
      body.appendChild(card);
    }
  }
  scrollChat();
}

function resetAssistant() {
  state.assistantEl = null;
  state.assistantBlocks = [];
}

/* ---------- tool activity panel ---------- */
function toolCard(name, args) {
  const item = el('div', 'tool-item');
  item.innerHTML = '<span class="t-name">' + esc(name) + '</span>' +
    '<span class="t-time">' + fmtTime() + '</span>' +
    '<div class="t-args">' + esc(args || '') + '</div>';
  toolList.prepend(item);
  while (toolList.children.length > 30) toolList.lastChild.remove();
  $('tool-count').textContent = toolList.children.length;
  return item;
}

/* ---------- todos ---------- */
function renderTodos(phases) {
  todoList.innerHTML = '';
  if (!phases || !phases.length) {
    todoList.appendChild(el('div', 'muted', 'No plan yet.'));
    return;
  }
  for (const phase of phases) {
    const p = el('div', 'todo-phase');
    p.appendChild(el('div', 'p-name', phase.name));
    for (const task of phase.tasks || []) {
      const row = el('div', 'todo-task ' + (task.status || 'pending'));
      row.appendChild(el('span', 'box'));
      row.appendChild(el('span', 't-text', task.content));
      p.appendChild(row);
    }
    todoList.appendChild(p);
  }
}

/* ---------- system panel ---------- */
function renderSys(data) {
  const rows = [
    ['Model', data.model ? data.model.provider + '/' + data.model.id : '—'],
    ['Thinking', data.thinkingLevel || '—'],
    ['Streaming', String(!!data.isStreaming)],
    ['Compacting', String(!!data.isCompacting)],
    ['Fast mode', String(!!data.fastModeActive)],
    ['Session', data.sessionName || data.sessionId || '—'],
    ['Messages', String(data.messageCount ?? '—')],
    ['Queued', String(data.queuedMessageCount ?? 0)],
    ['Context', data.contextUsage ? data.contextUsage.tokens + ' / ' + data.contextUsage.contextWindow + ' (' + Math.round(data.contextUsage.percent * 100) + '%)' : '—'],
    ['Steering', data.steeringMode || '—'],
    ['Follow-up', data.followUpMode || '—'],
    ['Interrupt', data.interruptMode || '—'],
  ];
  sysKv.innerHTML = rows.map(([k, v]) =>
    '<div class="row"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>'
  ).join('');
}

/* ---------- pills ---------- */
function setPills() {
  $('pill-model').textContent = 'model ' + state.model;
  $('pill-thinking').textContent = 'thinking ' + state.thinking;
  $('pill-session').textContent = 'session ' + (state.session || '—');
}

function setLink(mode) {
  const d = $('dot-link');
  d.className = 'dot ' + mode;
}

/* ---------- command datalist ---------- */
function renderCommands(cmds) {
  state.commands = cmds || [];
  cliCommands.innerHTML = '';
  for (const c of state.commands) {
    const opt = document.createElement('option');
    opt.value = c.name;
    cliCommands.appendChild(opt);
  }
}

/* ---------- SSE frame dispatch ---------- */
function onFrame(f) {
  switch (f.type) {
    case 'ready':
      state.connected = true;
      setLink('on');
      toast('JARVIS online');
      refreshState();
      break;

    case 'rpc_exit':
      state.connected = false;
      setLink('err');
      addMessage('system', 'omp process exited (code ' + f.code + '). Restarting…');
      break;

    case 'rpc_error':
      setLink('err');
      addMessage('system', 'omp error: ' + f.error);
      break;

    case 'rpc_stderr':
      if (f.text && f.text.trim()) addMessage('system', f.text.trim());
      break;

    case 'agent_start':
      state.streaming = true;
      setLink('busy');
      resetAssistant();
      break;

      // Speak the final assistant text when TTS is on.
      if (speech.ttsOn) {
        const texts = (f.messages || [])
          .filter((m) => m.role === 'assistant')
          .flatMap((m) => (m.content || []).filter((b) => b.type === 'text').map((b) => b.text))
          .filter(Boolean);
        if (texts.length) speak(texts[texts.length - 1]);
      }
      resetAssistant();
      refreshState();
      break;
      resetAssistant();
      refreshState();
      break;

    case 'message_start':
      state.streaming = true;
      setLink('busy');
      resetAssistant();
      break;

    case 'message_update': {
      const ev = f.assistantMessageEvent;
      if (ev && ev.type === 'text_delta') {
        const last = state.assistantBlocks[state.assistantBlocks.length - 1];
        if (last && last.type === 'text') last.text += ev.delta;
        else state.assistantBlocks.push({ type: 'text', text: ev.delta });
        renderAssistant();
      } else if (ev && ev.type === 'thinking_delta') {
        const last = state.assistantBlocks[state.assistantBlocks.length - 1];
        if (last && last.type === 'thinking') last.text += ev.delta;
        else state.assistantBlocks.push({ type: 'thinking', text: ev.delta });
        renderAssistant();
      } else if (ev && ev.type === 'toolcall_delta') {
        const last = state.assistantBlocks[state.assistantBlocks.length - 1];
        if (last && last.type === 'tool_use') last.input = (last.input || '') + (ev.delta || '');
        else state.assistantBlocks.push({ type: 'tool_use', name: ev.name || 'tool', input: ev.delta || '' });
        renderAssistant();
      } else if (f.message && f.message.content) {
        // Fallback: render the partial message content array.
        state.assistantBlocks = f.message.content.map((b) => {
          if (b.type === 'text') return { type: 'text', text: b.text || '' };
          if (b.type === 'thinking') return { type: 'thinking', text: b.thinking || '' };
          if (b.type === 'tool_use') return { type: 'tool_use', name: b.name || 'tool', input: JSON.stringify(b.input || {}) };
          return { type: 'text', text: '' };
        });
        renderAssistant();
      }
      break;
    }

    case 'message_end':
      resetAssistant();
      break;

    case 'tool_execution_start': {
      const card = toolCard(f.toolName || f.name || 'tool', JSON.stringify(f.arguments || f.input || {}));
      card.dataset.toolId = f.toolCallId || f.id || '';
      break;
    }

    case 'tool_execution_update': {
      const card = findTool(f.toolCallId || f.id);
      if (card) {
        const r = card.querySelector('.t-result');
        if (r) r.textContent = (r.textContent || '') + (f.partialResultText || f.text || '');
      }
      break;
    }

    case 'tool_execution_end': {
      const card = findTool(f.toolCallId || f.id);
      if (card) {
        const r = el('div', 't-result' + (f.isError ? ' err' : ''));
        r.textContent = truncate(f.resultText || f.result || f.error || 'done', 400);
        card.appendChild(r);
      }
      break;
    }

    case 'todo_reminder':
    case 'todo_auto_clear':
      refreshState();
      break;

    case 'model_changed':
      state.model = f.model ? f.model.provider + '/' + f.model.id : state.model;
      setPills();
      break;

    case 'thinking_level_changed':
      state.thinking = f.level || state.thinking;
      setPills();
      break;

    case 'available_commands_update':
      renderCommands(f.commands);
      break;

    case 'notice':
      addMessage('system', f.message || f.text || '');
      break;

    case 'auto_compaction_start':
      addMessage('system', 'Compacting context…');
      break;
    case 'auto_compaction_end':
      addMessage('system', 'Compaction complete.');
      break;

    default:
      break;
  }
}

function findTool(id) {
  if (!id) return null;
  for (const c of toolList.children) if (c.dataset.toolId === id) return c;
  return null;
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* ---------- state refresh ---------- */
async function refreshState() {
  try {
    const r = await fetch('/api/state');
    const j = await r.json();
    if (!j.ok) return;
    const d = j.data;
    state.model = d.model ? d.model.provider + '/' + d.model.id : state.model;
    state.thinking = d.thinkingLevel || state.thinking;
    state.session = d.sessionName || d.sessionId || state.session;
    state.fast = !!d.fastModeActive;
    setPills();
    renderTodos(d.todoPhases);
    renderSys(d);
  } catch (e) { /* server warming */ }
}

/* ---------- send ---------- */
async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  addMessage('user', trimmed);
  chatInput.value = '';
  autosize();
  const r = await api('/api/cmd', { type: 'prompt', message: trimmed });
  if (!r.ok) addMessage('system', 'send failed: ' + r.error);
}

/* ---------- CLI ---------- */
async function runCli() {
  const raw = cliInput.value.trim();
  if (!raw) return;
  const args = raw.split(/\s+/);
  cliOutput.textContent = 'running: omp ' + raw + ' …';
  const r = await api('/api/cli', { args });
  if (r.ok) {
    cliOutput.textContent = (r.stdout || '').trim() || '(no output)';
  } else {
    cliOutput.textContent = 'exit ' + r.code + '\n' + (r.stderr || r.error || '').trim();
  }
}

/* ---------- composer autosize + slash hints ---------- */
function autosize() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 180) + 'px';
}

function slashHints() {
  // Simple inline hint: show matching commands in a toast-like list.
  const v = chatInput.value;
  if (!v.startsWith('/')) return;
  const q = v.slice(1).toLowerCase();
  const matches = state.commands.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
  if (!matches.length) return;
  const hint = document.createElement('div');
  hint.id = 'slash-hint';
  hint.style.cssText = 'position:absolute;bottom:100%;left:18px;background:#0a1220;border:1px solid var(--line-strong);border-radius:8px;padding:6px 10px;font-family:var(--mono);font-size:11px;color:var(--cyan);z-index:5;';
  hint.textContent = matches.map((c) => '/' + c.name).join('   ');
  const old = document.getElementById('slash-hint');
  if (old) old.remove();
  $('composer').appendChild(hint);
}

/* ---------- events ---------- */
function connect() {
  const es = new EventSource('/events');
  es.onmessage = (e) => {
    try { onFrame(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  es.onerror = () => {
    state.connected = false;
    setLink('err');
  };
}

/* ---------- speech (Edge STT/TTS) ---------- */
const speech = {
  ttsOn: false,
  recOn: false,
  recog: null,
  voice: 'en-US-ChristopherNeural',
  audio: null,      // current playback element
  fallback: false,  // true when server TTS unavailable -> speechSynthesis
};

const TTS_VOICES = [
  ['en-US-ChristopherNeural', 'Christopher (US, male)'],
  ['en-US-GuyNeural', 'Guy (US, male)'],
  ['en-US-EricNeural', 'Eric (US, male)'],
  ['en-US-AriaNeural', 'Aria (US, female)'],
  ['en-US-JennyNeural', 'Jenny (US, female)'],
  ['en-US-EmmaMultilingualNeural', 'Emma (US, multilingual)'],
  ['en-GB-RyanNeural', 'Ryan (UK, male)'],
  ['en-GB-SoniaNeural', 'Sonia (UK, female)'],
  ['en-AU-WilliamNeural', 'William (AU, male)'],
  ['en-AU-NatashaNeural', 'Natasha (AU, female)'],
];

function populateVoices() {
  const sel = $('tts-voice');
  sel.innerHTML = '';
  for (const [id, label] of TTS_VOICES) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.value = speech.voice;
}

function speak(text) {
  if (!speech.ttsOn) return;
  stopSpeaking();
  const clean = String(text).trim();
  if (!clean) return;
  // Server path: edge-tts MP3 via /api/tts.
  fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: clean, voice: speech.voice, rate: '+0%' }),
  })
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      speech.audio = a;
      a.onended = () => { URL.revokeObjectURL(url); speech.audio = null; };
      a.onerror = () => { URL.revokeObjectURL(url); speech.audio = null; };
      a.play().catch(() => {});
    })
    .catch(() => {
      // Fallback: browser speechSynthesis (Edge neural voices).
      speech.fallback = true;
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(clean);
      const en = window.speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
      const v = en.find((x) => /Neural/i.test(x.name)) || en[0];
      if (v) u.voice = v;
      u.rate = 1.0;
      window.speechSynthesis.speak(u);
    });
}

function stopSpeaking() {
  if (speech.audio) {
    speech.audio.pause();
    speech.audio = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function toggleTts() {
  speech.ttsOn = !speech.ttsOn;
  $('btn-tts').classList.toggle('on', speech.ttsOn);
  if (!speech.ttsOn) stopSpeaking();
  toast(speech.ttsOn ? 'Spoken replies ON (Edge TTS)' : 'Spoken replies OFF');
}

function initStt() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('btn-mic').title = 'STT not supported in this browser — use Edge/Chrome';
    $('btn-mic').disabled = true;
    return;
  }
  speech.recog = new SR();
  speech.recog.lang = 'en-US';
  speech.recog.interimResults = true;
  speech.recog.continuous = false;
  speech.recog.onresult = (e) => {
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
    }
    if (final) {
      chatInput.value = (chatInput.value ? chatInput.value + ' ' : '') + final.trim();
      autosize();
    }
  };
  speech.recog.onend = () => {
    speech.recOn = false;
    $('btn-mic').classList.remove('rec');
    $('btn-mic').textContent = '🎤';
  };
  speech.recog.onerror = (e) => {
    speech.recOn = false;
    $('btn-mic').classList.remove('rec');
    $('btn-mic').textContent = '🎤';
    if (e.error !== 'aborted' && e.error !== 'no-speech') toast('STT error: ' + e.error);
  };
}

function toggleMic() {
  if (!speech.recog) return;
  if (speech.recOn) {
    speech.recog.stop();
    return;
  }
  try {
    speech.recog.start();
    speech.recOn = true;
    $('btn-mic').classList.add('rec');
    $('btn-mic').textContent = '◉';
    toast('Listening…');
  } catch (e) {
    toast('Mic error: ' + e.message);
  }
}

/* ---------- wire up ---------- */
$('btn-send').addEventListener('click', () => sendMessage(chatInput.value));
$('btn-abort').addEventListener('click', async () => {
  await api('/api/cmd', { type: 'abort' });
  toast('Abort sent');
});
$('tts-voice').addEventListener('change', (e) => {
  speech.voice = e.target.value;
  toast('TTS voice: ' + e.target.selectedOptions[0].textContent);
});
populateVoices();
$('cli-run').addEventListener('click', runCli);
$('cli-run').addEventListener('click', runCli);
cliInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runCli(); } });

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(chatInput.value);
  }
});
chatInput.addEventListener('input', () => { autosize(); slashHints(); });
chatInput.addEventListener('blur', () => {
  const old = document.getElementById('slash-hint');
  if (old) old.remove();
});

// Clickable pills: cycle model / thinking.
$('pill-model').addEventListener('click', async () => {
  const r = await api('/api/cmd', { type: 'cycle_model' });
  if (r.ok) toast('Model cycled');
  refreshState();
});
$('pill-thinking').addEventListener('click', async () => {
  const r = await api('/api/cmd', { type: 'cycle_thinking_level' });
  if (r.ok) toast('Thinking level cycled');
  refreshState();
});

// Tabs.
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// Boot.
setLink('err');
setPills();
connect();
refreshState();
setInterval(refreshState, 5000);
