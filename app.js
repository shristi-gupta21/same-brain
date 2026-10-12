const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const howDialog = document.querySelector('#how-dialog');
const state = { session: localStorage.getItem('same-brain-session'), room: null, screen: 'home', questions: 5, seconds: 15, draft: '', source: null, tick: null, pollTimer: null, pollNow: null, draftTimer: null, offset: 0, error: '', pollInFlight: false, syncFailures: 0 };
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const playerById = id => state.room?.players.find(p => p.id === id);
function toast(message) { toastEl.textContent = message; toastEl.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => toastEl.classList.remove('show'), 2600); }
function stopStream() { state.source?.close(); state.source = null; clearInterval(state.tick); clearInterval(state.pollTimer); state.pollTimer = null; }
function sync() {
  stopStream();
  if (!state.session) return;
  let previousSnapshot = '';
  const poll = async () => {
    if (!state.session || state.pollInFlight) return;
    state.pollInFlight = true;
    try {
      const response = await fetch(`/api/state?session=${encodeURIComponent(state.session)}`, { cache: 'no-store' });
      if (response.status === 401) { home(); toast('That room session has ended. You can start a fresh game.'); return; }
      if (!response.ok) throw new Error(`Sync failed (${response.status}).`);
      const next = await response.json();
      if (state.syncFailures >= 3) toast('Connection restored.');
      state.syncFailures = 0;
      state.offset = next.serverNow - Date.now();
      const comparable = { ...next }; delete comparable.serverNow;
      const serialized = JSON.stringify(comparable);
      if (serialized === previousSnapshot) return;
      previousSnapshot = serialized;
      const previousRoom = state.room;
      const previous = previousRoom?.state;
      const input = document.querySelector('[name="answer"]');
      const focused = document.activeElement === input;
      const selection = focused ? input.selectionStart : null;
      if (focused) state.draft = input.value;
      state.room = next;
      state.screen = ['QUESTION', 'COUNTDOWN'].includes(next.state) ? 'game' : next.state === 'REVEAL' ? 'reveal' : next.state === 'RESULTS' ? 'results' : 'lobby';
      if (previous !== next.state && next.state === 'QUESTION') state.draft = '';
      const sameGameView = previousRoom && state.screen === 'game' && previous === next.state
        && previousRoom.round === next.round && previousRoom.question?.text === next.question?.text;
      if (sameGameView) patchGame();
      else draw();
      if (focused && state.screen === 'game' && !next.ownSubmitted) {
        const nextInput = document.querySelector('[name="answer"]');
        nextInput?.focus();
        if (selection != null) nextInput?.setSelectionRange(selection, selection);
      }
    } catch {
      state.syncFailures += 1;
      if (state.syncFailures === 3) toast('Connection interrupted. Reconnecting…');
    } finally { state.pollInFlight = false; }
  };
  state.pollNow = poll;
  poll();
  state.pollTimer = setInterval(poll, 1200);
}
async function api(path, data = {}, needsSession = true) {
  const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(needsSession && state.session ? { 'x-session': state.session } : {}) }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
}
async function enterRoom(path, data) {
  try {
    const result = await api(path, data, false);
    state.session = result.session; localStorage.setItem('same-brain-session', result.session); state.draft = ''; state.error = ''; sync();
  } catch (error) { state.error = error.message; draw(); }
}
function home() { stopStream(); state.session = null; state.room = null; state.draft = ''; state.screen = 'home'; localStorage.removeItem('same-brain-session'); history.replaceState(null, '', location.pathname); draw(); }
function back() { state.screen = 'home'; state.error = ''; draw(); }
function initials(name) { return safe((name || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase()); }
function topTitle(title, subtitle = '') { return `<div class="form-head"><button class="back-link" data-action="back">← &nbsp;Back</button><h1 class="title">${title}</h1>${subtitle ? `<p class="lead">${subtitle}</p>` : ''}</div>`; }
function homeView() {
  const invite = new URLSearchParams(location.search).get('room') || '';
  return `<section class="screen hero">
    <div class="hero-copy"><div class="eyebrow">A PARTY GAME FOR YOUR GROUP CHAT</div><h1>Think alike.<br /><em>Win together-ish.</em></h1><p>Same question. Six different brains. Somehow, the same answer.</p>
      <div class="actions"><button class="button primary" data-action="create"><span class="action-icon">＋</span>Create a game</button><button class="button secondary" data-action="quick"><span class="action-icon" style="background:#eeeee8;color:#555">↗</span>Quick play</button><button class="button subtle" data-action="join">Join with a room code</button></div>
      <p class="hero-note">No accounts, no downloads. Just your people and one shared brain cell.</p>
    </div>
    <div class="art-stage" aria-hidden="true"><div class="orbit"></div><div class="confetti-dot"></div><div class="confetti-spark">✳</div><div class="brain-card"><span class="brain-illustration">🧠</span></div><div class="float-tag tag-one">“<b>Pizza</b>”</div><div class="float-tag tag-two">“<b>Pizza</b>”</div></div>
    ${invite ? `<span hidden data-invite="${safe(invite.toUpperCase())}"></span>` : ''}
  </section>`;
}
function createView() {
  return `<section class="screen narrow">${topTitle('Set the scene', 'A few friends, a few questions, and a suspicious amount of mind reading.')}
    <form class="form-stack" id="create-form"><label><span class="field-label">Your nickname</span><input class="text-input" name="name" maxlength="18" placeholder="What should we call you?" autocomplete="nickname" required /></label>
    <div><span class="field-label">Number of questions</span><div class="segmented">${[3,5,10].map(n => `<button type="button" class="segment ${n === state.questions ? 'active' : ''}" data-choice="questions" data-value="${n}">${n} ${n === 3 ? 'Quick' : n === 5 ? 'Classic' : 'Extended'}</button>`).join('')}</div></div>
    <div><span class="field-label">Answer timer</span><div class="segmented">${[10,15,20].map(n => `<button type="button" class="segment ${n === state.seconds ? 'active' : ''}" data-choice="seconds" data-value="${n}">${n} seconds</button>`).join('')}</div></div>
    <div class="form-error">${safe(state.error)}</div><button class="button primary full" type="submit">Create private room <span aria-hidden="true">→</span></button><div class="form-tip">Your friends can join with a code or the invitation link.</div></form>
  </section>`;
}
function joinView() {
  const invite = new URLSearchParams(location.search).get('room') || '';
  return `<section class="screen narrow">${topTitle('You’re invited', 'Grab a nickname and jump into the room.')}
    <form class="form-stack" id="join-form"><label><span class="field-label">Your nickname</span><input class="text-input" name="name" maxlength="18" placeholder="What should we call you?" autocomplete="nickname" required /></label>
    <label><span class="field-label">Room code</span><input class="text-input" name="code" maxlength="6" placeholder="e.g. BRN482" value="${safe(invite.toUpperCase())}" autocapitalize="characters" required /></label>
    <div class="form-error">${safe(state.error)}</div><button class="button primary full" type="submit">Join room <span aria-hidden="true">→</span></button></form></section>`;
}
function quickView() {
  return `<section class="screen narrow">${topTitle('Find your people', 'We’ll gather a few brains and start a public match.')}
    <form class="form-stack" id="quick-form"><label><span class="field-label">Your nickname</span><input class="text-input" name="name" maxlength="18" placeholder="What should we call you?" autocomplete="nickname" required /></label>
    <div class="form-error">${safe(state.error)}</div><button class="button primary full" type="submit">Find a match <span aria-hidden="true">→</span></button><div class="form-tip">Public matches use 5 questions and a 15 second timer.</div></form></section>`;
}
function roomView() {
  const room = state.room; const host = room.playerId === room.hostId; const players = room.players;
  const slots = Array.from({ length: 6 }, (_, i) => players[i] ? `<div class="player-tile"><span class="avatar" style="background:${players[i].color}">${initials(players[i].name)}</span><span style="min-width:0"><span class="player-name">${safe(players[i].name)}${players[i].id === room.playerId ? ' (you)' : ''}</span>${players[i].id === room.hostId ? '<span class="host-label">HOST</span>' : ''}</span></div>` : '<div class="empty-slot">+ &nbsp; Open seat</div>').join('');
  const inviteUrl = `${location.origin}${location.pathname}?room=${room.roomCode}`;
  return `<section class="screen room"><div class="room-heading"><div><div class="room-id"><span class="status-dot"></span>${room.mode === 'public' ? 'PUBLIC MATCH' : 'PRIVATE ROOM'}</div><h1 class="title">${room.state === 'NO_MATCH' ? 'No match found' : room.mode === 'public' ? 'Finding your people' : 'The hangout'}</h1><p class="lead">${room.state === 'NO_MATCH' ? 'No one joined this time. Give Quick Play another try.' : room.mode === 'public' ? 'Your match will start as soon as everyone is ready.' : 'Send the invite. The more brains, the better.'}</p></div></div>
    <div class="room-code-box"><div><div class="room-code-label">Room code</div><div class="room-code">${room.roomCode}</div></div><button class="copy-button" data-action="copy-code">Copy code</button><button class="copy-button" data-action="copy-link">Share invite</button></div>
    <div class="room-layout"><div><p class="section-label">Players <span style="color:#c0bbb2">${players.length}/6</span></p><div class="player-grid">${slots}</div></div>
      <aside class="settings-panel"><p class="section-label">Game settings</p><div class="setting-row"><span>Questions</span><b>${room.config.questions}</b></div><div class="setting-row"><span>Answer time</span><b>${room.config.seconds} sec</b></div><div class="setting-row"><span>Match length</span><b>~${Math.round(room.config.questions * (room.config.seconds + 10) / 60)} min</b></div>
      <div class="room-controls">${room.state === 'NO_MATCH' ? `<button class="button primary" data-action="home">Back to home</button>` : room.mode === 'public' ? `<button class="button primary" disabled>Finding players…</button>` : host ? `<button class="button primary" data-action="start" ${players.filter(p=>p.connected).length < 2 ? 'disabled' : ''}>Start game <span aria-hidden="true">→</span></button><p class="waiting-copy">${players.length < 2 ? 'Need one more brain to get started.' : 'Everyone in? Let’s go.'}</p>` : '<p class="waiting-copy">Waiting for the host to start…</p>'}</div>
      </aside></div>
  </section>`;
}
function remaining() { return state.room?.question ? Math.max(0, Math.ceil((state.room.question.endsAt - (Date.now() + state.offset)) / 1000)) : 0; }
function answerArea() {
  const value = remaining();
  return state.room.ownSubmitted
    ? `<div class="waiting-box"><span class="lock-icon">🔒</span> Answer locked! Let’s see who thinks like you.</div>`
    : `<form class="answer-form" id="answer-form"><input class="text-input" name="answer" maxlength="30" autocomplete="off" placeholder="Type your answer…" value="${safe(state.draft)}" ${value === 0 ? 'disabled' : ''} autofocus /><button class="button primary" type="submit" ${value === 0 ? 'disabled' : ''}>Lock it in <span aria-hidden="true">↗</span></button></form><div class="answer-hint">30 characters max · your answer stays secret</div>`;
}
function patchGame() {
  const room = state.room;
  const count = document.querySelector('[data-submitted-count]');
  const fill = document.querySelector('.meter-fill');
  const area = document.querySelector('[data-answer-area]');
  if (count) count.textContent = `${room.submittedCount} / ${room.players.length}`;
  if (fill) fill.style.width = `${Math.min(100, room.submittedCount / room.players.length * 100)}%`;
  if (area && Boolean(area.querySelector('.waiting-box')) !== room.ownSubmitted) area.innerHTML = answerArea();
}
function tickGame() {
  const room = state.room;
  if (!room?.question || !['QUESTION', 'COUNTDOWN'].includes(room.state)) return;
  if (room.state === 'COUNTDOWN') {
    const count = document.querySelector('[data-countdown]');
    if (count) count.textContent = Math.max(1, Math.ceil((room.question.startsAt - (Date.now() + state.offset)) / 1000));
    return;
  }
  const value = remaining();
  const timer = document.querySelector('[data-timer]');
  if (timer) {
    timer.textContent = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    timer.classList.toggle('urgent', value <= 5);
  }
  const input = document.querySelector('[name="answer"]');
  const submit = document.querySelector('#answer-form button[type="submit"]');
  if (input) input.disabled = value === 0;
  if (submit) submit.disabled = value === 0;
}
function gameView() {
  const room = state.room; const countdown = room.state === 'COUNTDOWN' && Date.now() + state.offset < room.question.startsAt; const value = remaining();
  if (countdown) {
    const n = Math.max(1, Math.ceil((room.question.startsAt - (Date.now() + state.offset)) / 1000));
    return `<section class="screen countdown-screen"><div class="eyebrow">QUESTION ${room.round} OF ${room.config.questions}</div><div class="count-number" data-countdown>${n}</div><h2>Ready to sync?</h2><p>Same question, coming right up.</p></section>`;
  }
  return `<section class="screen game-wrap"><div class="game-meta"><span>QUESTION ${room.round} OF ${room.config.questions}</span><span class="timer ${value <= 5 ? 'urgent' : ''}" data-timer>${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}</span></div>
    <div class="question-card"><div class="eyebrow">${safe(room.question.category)} · THINK FAST</div><h1 class="question">${safe(room.question.text)}</h1></div>
    <div data-answer-area>${answerArea()}</div>
    <div class="submitted-meter"><div class="meter-top"><span>Brains locked in</span><span data-submitted-count>${room.submittedCount} / ${room.players.length}</span></div><div class="meter-track"><div class="meter-fill" style="width:${Math.min(100, room.submittedCount / room.players.length * 100)}%"></div></div></div>
  </section>`;
}
function board() { return [...state.room.players].sort((a,b) => b.score-a.score).map((p,i) => `<span class="compact-score">${i+1}. ${safe(p.name)}<b>${p.score}</b></span>`).join(''); }
function revealView() {
  const room = state.room, groups = room.reveal || [];
  return `<section class="screen reveal-screen"><div class="reveal-top"><div class="eyebrow">QUESTION ${room.round} RESULTS</div><h1 class="title">Who had the same brain?</h1><p class="question-small">${safe(room.question.text)}</p></div>
    ${groups.length ? `<div class="group-grid">${groups.map(group => `<article class="answer-group"><div class="group-answer">${safe(group.answer)}</div><div class="group-people">${group.players.map(p => `<span class="mini-person"><span class="mini-avatar" style="background:${p.color}">${initials(p.name)}</span>${safe(p.name)}</span>`).join('')}</div><div class="points">${group.players.length > 1 ? `<b>+${group.points} points each</b>` : 'No match this time'}</div></article>`).join('')}</div>` : '<div class="no-matches">No one answered this round. The brain cell is taking a quick break.</div>'}
    <div class="reveal-board"><span>Scoreboard</span><div class="compact-scores">${board()}</div></div></section>`;
}
function resultsView() {
  const room = state.room; const ordered = [...room.players].sort((a,b)=>b.score-a.score); const winners = room.winners || [];
  const winner = ordered[0]; const tied = winners.length > 1;
  return `<section class="screen results-screen"><div class="winner-crown">${tied ? '✳' : '♛'}</div><div class="eyebrow">${tied ? 'A VERY SAME-BRAIN FINISH' : 'THE BRAINIEST BRAIN'}</div><h1 class="winner-name">${tied ? 'It’s a tie!' : `${safe(winner?.name)} wins!`}</h1><div class="winner-points">${tied ? winners.map(id=>safe(playerById(id)?.name)).join(' & ') : safe(winner?.score)} ${tied ? '' : 'points'}</div>
    <table class="results-table"><thead><tr><th>#</th><th>Player</th><th>Matches</th><th style="text-align:right">Score</th></tr></thead><tbody>${ordered.map((p,i)=>`<tr><td class="rank">${String(i+1).padStart(2,'0')}</td><td><span style="display:inline-flex;align-items:center;gap:8px"><span class="mini-avatar" style="background:${p.color}">${initials(p.name)}</span>${safe(p.name)}${winners.includes(p.id) ? ' ✦' : ''}</span></td><td>${p.matches}</td><td class="score-cell">${p.score}</td></tr>`).join('')}</tbody></table>
    <div class="results-actions">${room.playerId === room.hostId ? '<button class="button primary" data-action="rematch">Play again <span aria-hidden="true">↻</span></button>' : '<button class="button secondary" disabled>Waiting for host…</button>'}<button class="button secondary" data-action="home">Back to home</button></div><div class="small-note">A fresh set of questions, same good company.</div></section>`;
}
function draw() {
  clearInterval(state.tick);
  if (state.screen === 'home') app.innerHTML = homeView();
  else if (state.screen === 'create') app.innerHTML = createView();
  else if (state.screen === 'join') app.innerHTML = joinView();
  else if (state.screen === 'quick') app.innerHTML = quickView();
  else if (state.screen === 'lobby') app.innerHTML = roomView();
  else if (state.screen === 'game') { app.innerHTML = gameView(); tickGame(); state.tick = setInterval(tickGame, 250); }
  else if (state.screen === 'reveal') app.innerHTML = revealView();
  else if (state.screen === 'results') app.innerHTML = resultsView();
}

document.addEventListener('click', async event => {
  const choice = event.target.closest('[data-choice]');
  if (choice) { state[choice.dataset.choice] = Number(choice.dataset.value); draw(); return; }
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  if (action === 'create') { state.screen='create';state.error='';draw(); }
  if (action === 'join') { state.screen='join';state.error='';draw(); }
  if (action === 'back') back();
  if (action === 'home') home();
  if (action === 'quick') { state.screen='quick';state.error='';draw(); }
  if (action === 'start') { button.disabled=true; try { await api('start'); } catch(error) { toast(error.message); } }
  if (action === 'rematch') { button.disabled=true; try { await api('rematch'); } catch(error) { toast(error.message);button.disabled=false; } }
  if (action === 'copy-code') { await navigator.clipboard?.writeText(state.room.roomCode); toast('Room code copied.'); }
  if (action === 'copy-link') { await navigator.clipboard?.writeText(`${location.origin}${location.pathname}?room=${state.room.roomCode}`); toast('Invite link copied.'); }
});
document.addEventListener('input', event => { if (event.target.name === 'answer') state.draft = event.target.value; });
document.addEventListener('input', event => {
  if (event.target.name !== 'answer' || !state.session) return;
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(() => api('draft', { answer: state.draft }).catch(() => {}), 500);
});
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target;
  if (form.id === 'create-form') { const name = new FormData(form).get('name'); enterRoom('create',{name,questions:state.questions,seconds:state.seconds}); }
  if (form.id === 'join-form') { const values = new FormData(form); enterRoom('join',{name:values.get('name'),code:values.get('code')}); }
  if (form.id === 'quick-form') { const name = new FormData(form).get('name'); enterRoom('quickplay',{name}); }
  if (form.id === 'answer-form') {
    const value = new FormData(form).get('answer'); state.draft = String(value || '');
    try { await api('submit',{answer:state.draft}); state.draft=''; }
    catch(error) { toast(error.message); }
  }
});
document.querySelector('#home-button').addEventListener('click', home);
document.querySelector('#how-button').addEventListener('click', () => howDialog.showModal());
document.querySelector('#close-how').addEventListener('click', () => howDialog.close());
document.querySelector('#got-it').addEventListener('click', () => howDialog.close());
howDialog.addEventListener('click', event => { if (event.target === howDialog) howDialog.close(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) state.pollNow?.(); });
window.addEventListener('online', () => state.pollNow?.());

if (state.session) { state.screen = 'lobby'; sync(); }
else { state.screen = new URLSearchParams(location.search).has('room') ? 'join' : 'home'; draw(); }
