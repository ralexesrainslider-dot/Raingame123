(function () {
'use strict';

/* ---------- hulpjes ---------- */
const $ = (s, r) => (r || document).querySelector(s);
function h(tag, props) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (k === 'class') el.className = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (let i = 2; i < arguments.length; i++) {
    [].concat(arguments[i]).forEach(c => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  }
  return el;
}
function hashStr(s) { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return Math.abs(x); }
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* opslag uit */ } }
};

/* ---------- staat ---------- */
const S = {
  me: null, ai: false,
  games: [], gamesState: 'loading',
  auth: { mode: 'signup', login: '', hint: '', until: 0, busy: false, lead: '' },
  studio: { tab: 'ai', html: '', tested: false, finished: false, title: '', desc: '', multi: false, busy: false, ctl: null, seq: 0 },
  play: null
};

async function api(path, opt) {
  opt = opt || {};
  const r = await fetch('/api' + path, {
    method: opt.method || 'GET',
    headers: opt.body ? { 'Content-Type': 'application/json' } : {},
    body: opt.body ? JSON.stringify(opt.body) : undefined,
    credentials: 'same-origin',
    signal: opt.signal
  });
  let data = null;
  try { data = await r.json(); } catch (e) { /* geen json */ }
  if (!r.ok) throw Object.assign(new Error((data && data.error) || 'Er ging iets mis. Probeer het opnieuw.'), { status: r.status, data: data || {} });
  return data;
}

/* ---------- spelvenster (iframe) ---------- */
const frames = [];
function postTo(f, msg) { try { f.frame.contentWindow.postMessage(msg, '*'); } catch (e) { /* venster weg */ } }
function unmountIn(box) {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (f.box !== box) continue;
    clearTimeout(f.timer);
    if (f.cleanup) f.cleanup();
    f.frame.remove();
    if (f.note) f.note.remove();
    frames.splice(i, 1);
  }
}
function mountFrame(box, src, ctx) {
  unmountIn(box);
  const fr = document.createElement('iframe');
  fr.setAttribute('sandbox', 'allow-scripts');
  fr.setAttribute('title', ctx.title || 'Game');
  const f = Object.assign({ frame: fr, box: box, ready: false }, ctx);
  frames.push(f);
  fr.src = src;
  box.append(fr);
  f.timer = setTimeout(() => {
    if (f.ready) return;
    f.note = h('p', { class: 'note' }, 'De game start niet. Controleer je verbinding en probeer opnieuw.');
    box.append(f.note);
  }, 7000);
  return f;
}
window.addEventListener('message', ev => {
  const f = frames.find(x => x.frame.contentWindow === ev.source);
  const m = ev.data;
  if (!f || !m || typeof m !== 'object') return;
  if (m.bd === 'ready') {
    f.ready = true; clearTimeout(f.timer);
    if (f.note) { f.note.remove(); f.note = null; }
    if (f.onReady) f.onReady(f);
  } else if (m.bd === 'send' && f.onSend) {
    f.onSend(f, m.data);
  }
});
function soloMode(f) {
  f.onSend = (ff, d) => postTo(ff, { bd: 'msg', data: d, from: 'jij', isMe: true });
  postTo(f, { bd: 'peers', me: 'jij', peers: [{ id: 'jij', name: S.me ? S.me.username : 'jij', isMe: true }] });
}

/* ---------- accounts ---------- */
function renderWho() {
  const who = $('#who');
  if (S.me) { who.textContent = '@' + S.me.username; who.hidden = false; } else who.hidden = true;
  $('#m-out').hidden = !S.me;
}
function afterLogin(user, isNew) {
  S.me = user; renderWho(); closeAuth(); loadGames();
  if (isNew) { toast('Je account is bevestigd. Welkom, @' + user.username + '!'); openStudio('ai'); }
  else toast('Ingelogd als @' + user.username);
}
const AUTH = {
  signup: { title: 'Maak een account', lead: 'Kies een e-mailadres, een wachtwoord en een gebruikersnaam. Daarna sturen we een code naar je e-mail.', show: ['f-email', 'f-pass', 'f-user'], btn: 'Account maken', pass: 'new-password' },
  login: { title: 'Inloggen', lead: 'Log in met je wachtwoord of met een code uit je e-mail.', show: ['f-login', 'f-pass'], btn: 'Inloggen', pass: 'current-password' },
  codelogin: { title: 'Inloggen met een code', lead: 'Vul je e-mailadres of gebruikersnaam in. We sturen je een code van 6 cijfers.', show: ['f-login'], btn: 'Stuur me een code', pass: 'current-password' },
  code: { title: 'Vul je code in', lead: '', show: ['f-code'], btn: 'Bevestig', pass: 'current-password' }
};
function setAuth(mode, opts) {
  const a = S.auth; a.mode = mode;
  if (opts) Object.assign(a, opts);
  const c = AUTH[mode];
  $('#auth-title').textContent = c.title;
  $('#auth-lead').textContent = mode === 'code'
    ? 'We hebben een code van 6 cijfers gestuurd naar ' + (a.hint || 'je e-mail') + '. Hij is 10 minuten geldig. Kijk ook in je spam.'
    : (a.lead || c.lead);
  ['f-email', 'f-login', 'f-pass', 'f-user', 'f-code'].forEach(id => { $('#' + id).hidden = c.show.indexOf(id) < 0; });
  $('#a-pass').setAttribute('autocomplete', c.pass);
  $('#auth-go').textContent = c.btn;
  $('#auth-err').textContent = '';
  const alt = $('#auth-alt'); alt.textContent = '';
  const link = (t, fn, id) => h('button', { class: 'link', type: 'button', id: id || null, onclick: fn }, t);
  if (mode === 'signup') alt.append(link('Ik heb al een account', () => setAuth('login', { lead: '' })));
  if (mode === 'login') alt.append(link('Inloggen met een code per e-mail', () => setAuth('codelogin', { lead: '' })), link('Nog geen account? Maak er een', () => setAuth('signup', { lead: '' })));
  if (mode === 'codelogin') alt.append(link('Liever inloggen met je wachtwoord', () => setAuth('login', { lead: '' })));
  if (mode === 'code') { alt.append(link('Stuur de code opnieuw', resendCode, 'resend'), link('Terug', () => setAuth('login', { lead: '' }))); tickResend(); }
  $('#auth').hidden = false;
  setTimeout(() => {
    const first = { signup: '#a-email', login: '#a-login', codelogin: '#a-login', code: '#a-code' }[mode];
    const el = $(first); if (el && !el.closest('[hidden]')) el.focus();
  }, 30);
}
function tickResend() {
  const b = $('#resend');
  if (!b || S.auth.mode !== 'code') return;
  const left = Math.ceil((S.auth.until - Date.now()) / 1000);
  if (left > 0) { b.disabled = true; b.textContent = 'Opnieuw sturen kan over ' + left + ' s'; setTimeout(tickResend, 500); }
  else { b.disabled = false; b.textContent = 'Stuur de code opnieuw'; }
}
async function resendCode() {
  try {
    await api('/code/request', { method: 'POST', body: { login: S.auth.login } });
    S.auth.until = Date.now() + 60000; tickResend();
    $('#auth-err').textContent = '';
    toast('Er is een nieuwe code onderweg.');
  } catch (e) { $('#auth-err').textContent = e.message; }
}
function openAuth(mode, lead) { setAuth(mode, { lead: lead || '' }); }
function closeAuth() { $('#auth').hidden = true; $('#a-pass').value = ''; $('#a-code').value = ''; }
function toCodeStep(login, hint) {
  $('#a-code').value = '';
  S.auth.until = Date.now() + 60000;
  setAuth('code', { login: login, hint: hint || '' });
}
async function onAuthSubmit(e) {
  e.preventDefault();
  const a = S.auth;
  if (a.busy) return;
  const err = m => { $('#auth-err').textContent = m; };
  err('');
  a.busy = true; $('#auth-go').disabled = true;
  try {
    if (a.mode === 'signup') {
      const email = $('#a-email').value.trim(), pw = $('#a-pass').value, user = $('#a-user').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err('Vul een geldig e-mailadres in.');
      if (pw.length < 8) return err('Kies een wachtwoord van minstens 8 tekens.');
      if (!/^[a-z0-9_]{3,20}$/.test(user)) return err('Een gebruikersnaam heeft 3 tot 20 letters, cijfers of underscores.');
      const d = await api('/signup', { method: 'POST', body: { email: email, password: pw, username: user } });
      a.isNew = true;
      toCodeStep(d.login, d.hint);
    } else if (a.mode === 'login') {
      const login = $('#a-login').value.trim(), pw = $('#a-pass').value;
      if (!login) return err('Vul je e-mailadres of gebruikersnaam in.');
      if (!pw) return err('Vul je wachtwoord in.');
      try {
        const d = await api('/login', { method: 'POST', body: { login: login, password: pw } });
        afterLogin(d.user, false);
      } catch (ex) {
        if (ex.data && ex.data.needsCode) { a.isNew = true; toCodeStep(ex.data.login, ex.data.hint); } else throw ex;
      }
    } else if (a.mode === 'codelogin') {
      const login = $('#a-login').value.trim();
      if (!login) return err('Vul je e-mailadres of gebruikersnaam in.');
      await api('/code/request', { method: 'POST', body: { login: login } });
      a.isNew = false;
      toCodeStep(login, 'het e-mailadres van dit account');
    } else {
      const code = $('#a-code').value.replace(/\D/g, '');
      if (code.length !== 6) return err('Vul de 6 cijfers uit je e-mail in.');
      const d = await api('/code/verify', { method: 'POST', body: { login: a.login, code: code } });
      afterLogin(d.user, !!a.isNew);
    }
  } catch (ex) {
    err(ex.message);
  } finally {
    a.busy = false; $('#auth-go').disabled = false;
  }
}

/* ---------- plus-knop en menu ---------- */
function toggleMenu(force) {
  const m = $('#menu');
  const open = force === undefined ? m.hidden : force;
  m.hidden = !open;
  $('#plus').setAttribute('aria-expanded', String(open));
}
function onPlus() {
  if (!S.me) return openAuth('signup');
  toggleMenu();
}

/* ---------- lijst met games ---------- */
function emptyBox(title, text, btn) {
  return h('div', { class: 'empty' }, h('h3', null, title), h('p', null, text), btn || null);
}
async function loadGames() {
  try {
    const d = await api('/games');
    S.games = d.games; S.gamesState = 'ready';
  } catch (e) {
    if (S.gamesState !== 'ready') S.gamesState = 'error';
  }
  renderFeed();
}
function renderFeed() {
  const box = $('#feed');
  box.textContent = '';
  const n = S.games.length;
  $('#count').textContent = n + (n === 1 ? ' game' : ' games');
  if (S.gamesState === 'loading') return box.append(h('p', { class: 'note' }, 'Games laden...'));
  if (S.gamesState === 'error') return box.append(emptyBox('De games laden niet', 'Controleer je verbinding en probeer het opnieuw.', h('button', { class: 'btn primary', type: 'button', onclick: loadGames }, 'Opnieuw proberen')));
  if (!n) return box.append(emptyBox('Nog geen games', 'Blauwdruk is nieuw. Maak een account, laat de AI jouw game bouwen en wees de eerste op het platform.',
    h('button', { class: 'btn primary', type: 'button', onclick: onPlus }, S.me ? 'Bouw een game' : 'Account maken')));
  const grid = h('div', { class: 'grid' });
  S.games.forEach(g => grid.append(card(g)));
  box.append(grid);
}
function card(g) {
  const n = hashStr(g.id);
  const cover = h('div', { class: 'cover', 'aria-hidden': 'true' }, h('span', { class: 'ini' }, (g.title || '?').trim().charAt(0).toUpperCase()));
  cover.style.setProperty('--h', String(208 + (n % 34)));
  cover.style.setProperty('--a', String((n >> 3) % 180) + 'deg');
  cover.style.setProperty('--x', String(15 + (n % 70)) + '%');
  cover.style.setProperty('--y', String(15 + ((n >> 5) % 60)) + '%');
  return h('article', { class: 'card' }, cover,
    h('div', { class: 'cbody' },
      h('div', { class: 'ctitle' }, g.title, g.multi ? h('span', { class: 'badge' }, 'Multiplayer') : null),
      h('div', { class: 'cmeta' }, 'door @' + g.author),
      g.desc ? h('p', { class: 'cdesc' }, g.desc) : null,
      h('div', { class: 'cact' },
        h('button', { class: 'btn primary small', type: 'button', onclick: () => openPlay(g) }, 'Speel'),
        g.canDelete ? h('button', { class: 'btn small ghost', type: 'button', onclick: ev => confirmDelete(ev.currentTarget, g) }, 'Verwijder') : null)));
}
function confirmDelete(btn, g) {
  if (btn.dataset.sure) return doDelete(g);
  btn.dataset.sure = '1'; btn.textContent = 'Zeker weten?';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = 'Verwijder'; } }, 3000);
}
async function doDelete(g) {
  try { await api('/games/' + g.id, { method: 'DELETE' }); toast('Game verwijderd.'); loadGames(); }
  catch (e) { toast(e.message); }
}

/* ---------- speelvenster ---------- */
function setPlayCount(n) {
  const el = $('#play-count');
  if (n == null) { el.hidden = true; return; }
  el.hidden = false; el.textContent = n + (n === 1 ? ' speler' : ' spelers');
}
function connectRoom(f) {
  const g = S.play.g;
  const room = (g.id + '-' + S.play.code).toLowerCase();
  let ws;
  try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); }
  catch (e) { soloMode(f); setPlayCount(1); toast('Multiplayer kon niet starten. Je speelt alleen.'); return; }
  let opened = false;
  ws.onopen = () => { opened = true; ws.send(JSON.stringify({ t: 'join', room: room })); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'peers') { f.me = m.me; postTo(f, { bd: 'peers', me: m.me, peers: m.peers }); setPlayCount(m.peers.length); }
    else if (m.t === 'msg') postTo(f, { bd: 'msg', data: m.data, from: m.from, isMe: m.from === f.me });
    else if (m.t === 'full') toast('Deze kamer zit vol. Kies een andere kamer.');
  };
  ws.onclose = () => {
    if (!frames.includes(f)) return;
    if (!opened) { soloMode(f); setPlayCount(1); toast('Multiplayer kon niet verbinden. Je speelt alleen.'); }
    else toast('De verbinding met de kamer is verbroken. Start de game opnieuw.');
  };
  f.onSend = (ff, d) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'msg', data: d })); };
  f.cleanup = () => { ws.onclose = null; try { ws.close(); } catch (e) { /* al dicht */ } };
}
function startPlay() {
  const g = S.play.g;
  setPlayCount(null);
  mountFrame($('#play-box'), '/play/' + g.id, { title: g.title, onReady: g.multi ? connectRoom : null });
}
function openPlay(g) {
  if (g.multi && !S.me) return openAuth('login', 'Log in om multiplayer te spelen. Heb je nog geen account? Kies hieronder Maak er een.');
  S.play = { g: g, code: 'open' };
  $('#play-title').textContent = g.title;
  $('#play-author').textContent = 'door @' + g.author;
  $('#room-form').hidden = !g.multi;
  $('#room-code').value = 'open';
  $('#play').hidden = false;
  startPlay();
}
function closePlay() {
  unmountIn($('#play-box'));
  $('#play').hidden = true;
  S.play = null;
}

/* ---------- studio ---------- */
const STARTER = [
  '<!doctype html>',
  '<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
  '<style>',
  'html,body{margin:0;height:100%;background:#0a1a45;color:#fff;font-family:system-ui,sans-serif;overflow:hidden;touch-action:manipulation}',
  '#hud{position:absolute;top:14px;left:0;right:0;text-align:center;font-size:20px}',
  '#dot{position:absolute;width:64px;height:64px;border-radius:50%;background:#6fe3ff;border:0;cursor:pointer}',
  '</style></head><body>',
  '<div id="hud">Tik de stip! Score: <b id="s">0</b> &middot; Tijd: <b id="t">15</b></div>',
  '<button id="dot" aria-label="stip"></button>',
  '<scr' + 'ipt>',
  'var s=0,t=15,dot=document.getElementById("dot");',
  'function move(){dot.style.left=Math.random()*(innerWidth-64)+"px";dot.style.top=70+Math.random()*(innerHeight-140)+"px"}',
  'dot.onclick=function(){if(t>0){s++;document.getElementById("s").textContent=s;move()}};',
  'move();',
  'var iv=setInterval(function(){t--;document.getElementById("t").textContent=t;if(t<=0){clearInterval(iv);dot.style.display="none";document.getElementById("hud").textContent="Klaar! Score: "+s}},1000);',
  '</scr' + 'ipt></body></html>'
].join('\n');
const IDEAS = [
  ['Snake met levels', false],
  ['Memory met dieren', false],
  ['Ontwijk de vallende blokken', false],
  ['Vier op een rij voor twee spelers', true],
  ['Wie tikt het snelst? Race tegen elkaar', true]
];

function setTab(t) {
  S.studio.tab = t;
  $('#tab-ai').setAttribute('aria-selected', String(t === 'ai'));
  $('#tab-code').setAttribute('aria-selected', String(t === 'code'));
  $('#pane-ai').hidden = t !== 'ai';
  $('#pane-code').hidden = t !== 'code';
  if (t === 'code' && !$('#code-area').value) $('#code-area').value = STARTER;
}
function updateAiUi() {
  const st = S.studio, has = !!st.html;
  $('#ai-label').textContent = has ? 'Wat wil je aanpassen?' : 'Wat voor game wil je maken?';
  $('#ai-prompt').placeholder = has ? 'Bijvoorbeeld: maak hem sneller en voeg een score toe' : 'Bijvoorbeeld: een snelle snake-game met levels';
  $('#ai-go').textContent = has ? 'Pas aan' : 'Bouw mijn game';
  $('#ai-chips').hidden = has;
  $('#ai-multi-wrap').hidden = has;
  $('#ai-reset').hidden = !has || st.busy;
  $('#ai-go').disabled = st.busy || !S.ai;
  $('#ai-stop').hidden = !st.busy;
  if (!S.ai) $('#ai-status').textContent = 'De AI-bouwer staat op deze site nog uit. Je kunt wel zelf een game schrijven.';
}
function refreshPublish() {
  const st = S.studio;
  const done = $('#pub-done');
  done.disabled = !st.tested;
  if (!st.tested) { done.checked = false; st.finished = false; }
  const ok = !!st.html && st.tested && st.finished && st.title.trim().length >= 2;
  $('#pub-go').disabled = !ok;
  let msg = 'Klaar om te publiceren.';
  if (!st.html) msg = 'Bouw of schrijf eerst een game.';
  else if (!st.tested) msg = 'Test je game eerst in het testvenster.';
  else if (!st.finished) msg = 'Je kunt pas publiceren als je game af is. Vink dat hierboven aan.';
  else if (st.title.trim().length < 2) msg = 'Geef je game een naam.';
  const n = $('#pub-note');
  n.textContent = msg;
  n.className = 'note gap' + (ok ? ' ok' : '');
}
async function mountPreview() {
  const st = S.studio;
  const seq = ++st.seq;
  $('#stage-empty').hidden = true;
  $('#st-reload').hidden = false;
  try {
    const d = await api('/preview', { method: 'POST', body: { html: st.html } });
    if (seq !== st.seq) return;
    mountFrame($('#stage-box'), '/preview/' + d.token, {
      title: 'Testvenster',
      onReady: f => { st.tested = true; soloMode(f); refreshPublish(); }
    });
  } catch (e) {
    if (seq !== st.seq) return;
    if (e.status === 401) { S.me = null; renderWho(); openAuth('login', 'Je bent uitgelogd. Log opnieuw in om verder te gaan.'); }
    else toast(e.message);
  }
}
function saveDraft() {
  const st = S.studio;
  if (!st.html) return;
  ls.set('bp-draft', JSON.stringify({ html: st.html, title: st.title, desc: st.desc, multi: st.multi }));
}
function setHtml(html) {
  const st = S.studio;
  st.html = html; st.tested = false; st.finished = false;
  $('#pub-done').checked = false;
  $('#code-area').value = html;
  if (/Multiplayer\./.test(html)) { $('#pub-multi').checked = true; st.multi = true; }
  mountPreview();
  refreshPublish(); updateAiUi(); saveDraft();
}
function resetStudio() {
  const st = S.studio;
  if (st.ctl) st.ctl.abort();
  st.seq++;
  Object.assign(st, { html: '', tested: false, finished: false, title: '', desc: '', multi: false, busy: false, ctl: null });
  unmountIn($('#stage-box'));
  $('#stage-empty').hidden = false; $('#st-reload').hidden = true;
  ['#ai-prompt', '#pub-title', '#pub-desc', '#code-area'].forEach(s => { $(s).value = ''; });
  $('#pub-multi').checked = false; $('#ai-multi').checked = false; $('#pub-done').checked = false;
  $('#ai-status').textContent = ''; $('#code-status').textContent = '';
  ls.set('bp-draft', null);
  setTab(st.tab);
  refreshPublish(); updateAiUi();
}
function openStudio(tab) {
  toggleMenu(false);
  if (!S.me) return openAuth('signup');
  $('#view-home').hidden = true;
  $('#view-studio').hidden = false;
  setTab(tab || 'ai');
  updateAiUi(); refreshPublish();
  window.scrollTo(0, 0);
}
function goHome() {
  $('#view-studio').hidden = true;
  $('#view-home').hidden = false;
  toggleMenu(false);
  window.scrollTo(0, 0);
}

/* ---------- AI bouwt de game ---------- */
function extractHtml(t) {
  const m = t.match(/```(?:html)?[ \t]*\n([\s\S]*?)```/i);
  let s = m ? m[1] : ((t.match(/```(?:html)?[ \t]*\n([\s\S]*)$/i) || [])[1] || t);
  s = s.trim();
  const i = s.search(/<!doctype|<html/i);
  if (i > 0) s = s.slice(i);
  return s;
}
async function buildAI() {
  const st = S.studio;
  const status = $('#ai-status');
  if (!S.ai || st.busy) return;
  const idea = $('#ai-prompt').value.trim();
  if (idea.length < 3) { status.textContent = 'Vertel eerst welke game je wilt maken.'; return; }
  const editing = !!st.html;
  const ctl = new AbortController();
  st.busy = true; st.ctl = ctl;
  updateAiUi();
  status.textContent = 'De AI denkt na...';
  let text = '', truncated = false;
  try {
    const r = await fetch('/api/ai', {
      method: 'POST', credentials: 'same-origin', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: idea, multi: $('#ai-multi').checked, current: editing ? st.html : '' })
    });
    if (!r.ok) {
      let d = null; try { d = await r.json(); } catch (e) { /* geen json */ }
      if (r.status === 401) { S.me = null; renderWho(); openAuth('login', 'Je bent uitgelogd. Log opnieuw in om verder te gaan.'); }
      throw new Error((d && d.error) || 'Er ging iets mis bij het bouwen. Probeer het opnieuw.');
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const x = await reader.read();
      if (x.done) break;
      buf += dec.decode(x.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch (e) { continue; }
        if (m.d) { text += m.d; status.textContent = 'Bezig met bouwen... ' + Math.max(1, Math.round(text.length / 1000)) + 'k tekens'; }
        else if (m.error) throw new Error(m.error);
        else if (m.done) truncated = !!m.truncated;
      }
    }
    const html = extractHtml(text);
    if (html.length < 200 || html.indexOf('<') < 0) throw new Error('De AI gaf geen bruikbare game terug. Probeer het opnieuw of beschrijf het anders.');
    if (!editing) {
      st.multi = $('#ai-multi').checked || /Multiplayer\./.test(html);
      $('#pub-multi').checked = st.multi;
      if (!$('#pub-title').value) { st.title = idea.slice(0, 40); $('#pub-title').value = st.title; }
    }
    setHtml(html);
    $('#ai-prompt').value = '';
    status.textContent = truncated ? 'De game is afgekapt. Vraag om een eenvoudigere versie.' : 'Klaar. Test je game en vraag aanpassingen als je wilt.';
  } catch (e) {
    status.textContent = e.name === 'AbortError' ? 'Gestopt.' : e.message;
  } finally {
    st.busy = false; st.ctl = null; updateAiUi();
  }
}

/* ---------- publiceren ---------- */
async function publish() {
  const st = S.studio;
  const note = $('#pub-note');
  if ($('#pub-go').disabled) return;
  $('#pub-go').disabled = true;
  try {
    await api('/games', { method: 'POST', body: { title: st.title.trim(), desc: st.desc.trim(), multi: !!st.multi, html: st.html, finished: st.finished === true } });
    resetStudio(); goHome(); loadGames();
    toast('Gepubliceerd! Je game staat nu op Blauwdruk.');
  } catch (e) {
    if (e.status === 401) { S.me = null; renderWho(); openAuth('login', 'Je bent uitgelogd. Log opnieuw in en publiceer dan nog een keer.'); }
    note.textContent = e.message; note.className = 'note gap bad';
  } finally {
    if (!$('#view-studio').hidden) { $('#pub-go').disabled = false; refreshPublishKeepError(); }
  }
}
function refreshPublishKeepError() {
  const n = $('#pub-note');
  if (n.classList.contains('bad')) { const msg = n.textContent; refreshPublish(); n.textContent = msg; n.className = 'note gap bad'; }
  else refreshPublish();
}

/* ---------- koppelingen ---------- */
function bind() {
  $('#brand').addEventListener('click', () => { goHome(); });
  $('#plus').addEventListener('click', onPlus);
  $('#m-ai').addEventListener('click', () => openStudio('ai'));
  $('#m-code').addEventListener('click', () => openStudio('code'));
  $('#m-out').addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST', body: {} }); } catch (e) { /* toch uitloggen in de pagina */ }
    S.me = null; renderWho(); toggleMenu(false); goHome(); loadGames(); toast('Je bent uitgelogd.');
  });
  document.addEventListener('click', ev => { if (!$('#menu').hidden && !ev.target.closest('#menu,#plus')) toggleMenu(false); });
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (!$('#auth').hidden) closeAuth(); else if (!$('#play').hidden) closePlay(); else toggleMenu(false);
  });
  $('#auth-x').addEventListener('click', closeAuth);
  $('#auth').addEventListener('click', ev => { if (ev.target === $('#auth')) closeAuth(); });
  $('#auth-form').addEventListener('submit', onAuthSubmit);
  $('#a-code').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^\d ]/g, ''); });
  $('#play-x').addEventListener('click', closePlay);
  $('#room-form').addEventListener('submit', ev => {
    ev.preventDefault();
    S.play.code = ($('#room-code').value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)) || 'open';
    $('#room-code').value = S.play.code;
    startPlay();
  });
  $('#st-back').addEventListener('click', goHome);
  $('#tab-ai').addEventListener('click', () => setTab('ai'));
  $('#tab-code').addEventListener('click', () => setTab('code'));
  const chips = $('#ai-chips');
  IDEAS.forEach(i => chips.append(h('button', { class: 'chip', type: 'button', onclick: () => { $('#ai-prompt').value = i[0]; $('#ai-multi').checked = i[1]; $('#ai-prompt').focus(); } }, i[0])));
  $('#ai-go').addEventListener('click', buildAI);
  $('#ai-stop').addEventListener('click', () => { if (S.studio.ctl) S.studio.ctl.abort(); });
  $('#ai-reset').addEventListener('click', resetStudio);
  $('#code-run').addEventListener('click', () => {
    const v = $('#code-area').value.trim();
    if (v.length < 20 || v.indexOf('<') < 0) { $('#code-status').textContent = 'Schrijf eerst de HTML van je game.'; return; }
    if (v.length > 80000) { $('#code-status').textContent = 'Je game is te groot. Maak hem kleiner dan 80.000 tekens.'; return; }
    $('#code-status').textContent = 'Je game draait in het testvenster.';
    setHtml(v);
  });
  $('#code-area').addEventListener('input', () => {
    const st = S.studio;
    if ($('#code-area').value === st.html) return;
    st.tested = false; st.finished = false; $('#pub-done').checked = false;
    $('#code-status').textContent = 'Je code is veranderd. Test hem opnieuw.';
    refreshPublish();
  });
  $('#st-reload').addEventListener('click', () => { if (S.studio.html) mountPreview(); });
  $('#pub-title').addEventListener('input', e => { S.studio.title = e.target.value; refreshPublish(); });
  $('#pub-desc').addEventListener('input', e => { S.studio.desc = e.target.value; });
  $('#pub-title').addEventListener('change', saveDraft);
  $('#pub-desc').addEventListener('change', saveDraft);
  $('#pub-multi').addEventListener('change', e => { S.studio.multi = e.target.checked; saveDraft(); });
  $('#pub-done').addEventListener('change', e => { S.studio.finished = e.target.checked; refreshPublish(); });
  $('#pub-go').addEventListener('click', publish);
}

async function init() {
  bind();
  renderWho();
  try {
    const d = await api('/me');
    S.me = d.user; S.ai = !!d.ai;
  } catch (e) { /* offline: je blijft uitgelogd */ }
  renderWho();
  try {
    const x = JSON.parse(ls.get('bp-draft') || 'null');
    if (x && typeof x.html === 'string' && x.html) {
      Object.assign(S.studio, { html: x.html, title: String(x.title || ''), desc: String(x.desc || ''), multi: !!x.multi });
      $('#pub-title').value = S.studio.title; $('#pub-desc').value = S.studio.desc; $('#pub-multi').checked = S.studio.multi;
      $('#code-area').value = x.html;
      $('#ai-status').textContent = 'Je vorige concept is teruggezet. Klik op Opnieuw starten in het testvenster om hem te testen.';
      $('#stage-empty').hidden = true; $('#st-reload').hidden = false;
    }
  } catch (e) { /* geen concept */ }
  refreshPublish(); updateAiUi();
  loadGames();
  setInterval(() => { if (!document.hidden && !$('#view-home').hidden) loadGames(); }, 60000);
}
init();
})();
