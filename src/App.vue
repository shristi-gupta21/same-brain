<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

type Screen = 'home' | 'create' | 'join' | 'quick' | 'lobby' | 'game' | 'reveal' | 'results';
type Player = { id: string; name: string; color: string; connected: boolean; score: number; matches: number };
type RevealGroup = { answer: string; players: Pick<Player, 'id' | 'name' | 'color'>[]; points: number };
type Room = {
  roomCode: string; mode: 'public' | 'private'; hostId: string; playerId: string;
  config: { questions: number; seconds: number }; players: Player[];
  state: string; round: number; question: { text: string; category: string; startsAt: number; endsAt: number } | null;
  submittedCount: number; ownSubmitted: boolean; reveal?: RevealGroup[]; winners?: string[];
  serverNow: number;
};

const state = reactive({
  session: localStorage.getItem('same-brain-session') || '',
  room: null as Room | null,
  screen: 'home' as Screen,
  questions: 5,
  seconds: 15,
  draft: '',
  offset: 0,
  error: '',
  busy: '',
  toast: '',
  now: Date.now(),
});
const inviteCode = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';
const joinCode = ref(inviteCode);
const howDialog = ref<HTMLDialogElement | null>(null);
let socket: ReturnType<NonNullable<Window['io']>> | null = null;
let pollTimer: number | undefined;
let tickTimer: number | undefined;
let draftTimer: number | undefined;
let toastTimer: number | undefined;
let pollInFlight = false;
let socketWarned = false;
let syncFailures = 0;
let pollNow: (() => Promise<void>) | null = null;
let previousSnapshot = '';

const room = computed(() => state.room);
const remaining = computed(() => {
  const question = state.room?.question;
  return question ? Math.max(0, Math.ceil((question.endsAt - (state.now + state.offset)) / 1000)) : 0;
});
const countdown = computed(() => {
  const question = state.room?.question;
  return state.room?.state === 'COUNTDOWN' && question && state.now + state.offset < question.startsAt;
});
const countdownNumber = computed(() => {
  const question = state.room?.question;
  return question ? Math.max(1, Math.ceil((question.startsAt - (state.now + state.offset)) / 1000)) : 1;
});
const timerLabel = computed(() => `${String(Math.floor(remaining.value / 60)).padStart(2, '0')}:${String(remaining.value % 60).padStart(2, '0')}`);
const submittedPercent = computed(() => state.room?.players.length ? Math.min(100, state.room.submittedCount / state.room.players.length * 100) : 0);
const rankedPlayers = computed(() => [...(state.room?.players || [])].sort((a, b) => b.score - a.score));
const winners = computed(() => state.room?.winners || []);
const winnerTied = computed(() => winners.value.length > 1);
const winner = computed(() => rankedPlayers.value[0]);
const winnerNames = computed(() => winners.value.map(id => state.room?.players.find(player => player.id === id)?.name).filter(Boolean).join(' & '));
const inviteUrl = computed(() => `${location.origin}${location.pathname}?room=${state.room?.roomCode || ''}`);

function toast(message: string) {
  state.toast = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { state.toast = ''; }, 2600);
}

function stopStream() {
  socket?.disconnect();
  socket = null;
  window.clearInterval(pollTimer);
  pollTimer = undefined;
  pollNow = null;
}

function screenFor(next: Room): Screen {
  if (next.state === 'QUESTION' || next.state === 'COUNTDOWN') return 'game';
  if (next.state === 'REVEAL') return 'reveal';
  if (next.state === 'RESULTS') return 'results';
  return 'lobby';
}

function connectRealtime() {
  if (!state.session || socket || typeof window.io !== 'function') return;
  const connection = window.io({
    path: '/api/socket-io/socket.io',
    transports: ['websocket'],
    auth: { session: state.session },
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 5000,
  });
  socket = connection;
  connection.on('connect', () => {
    if (socketWarned) toast('Live updates restored.');
    socketWarned = false;
    void pollNow?.();
  });
  connection.on('room:changed', () => { void pollNow?.(); });
  connection.on('connect_error', () => {
    if (!socketWarned) toast('Live updates reconnecting.');
    socketWarned = true;
  });
}

async function sync() {
  stopStream();
  if (!state.session) return;
  previousSnapshot = '';
  const poll = async () => {
    if (!state.session || pollInFlight) return;
    pollInFlight = true;
    try {
      const response = await fetch(`/api/state?session=${encodeURIComponent(state.session)}`, { cache: 'no-store' });
      if (response.status === 401) {
        home();
        toast('That room session has ended. You can start a fresh game.');
        return;
      }
      if (!response.ok) throw new Error(`Sync failed (${response.status}).`);
      const next = await response.json() as Room;
      if (syncFailures >= 3) toast('Connection restored.');
      syncFailures = 0;
      state.offset = next.serverNow - Date.now();
      const comparable = { ...next } as Partial<Room>;
      delete comparable.serverNow;
      const serialized = JSON.stringify(comparable);
      if (serialized === previousSnapshot) return;
      previousSnapshot = serialized;
      const previousRound = state.room?.round;
      const previousQuestion = state.room?.question?.text;
      const previousState = state.room?.state;
      if (previousState !== next.state && next.state === 'QUESTION' || previousRound !== next.round || previousQuestion !== next.question?.text) {
        if (next.state === 'QUESTION' || next.state === 'COUNTDOWN') state.draft = '';
      }
      state.room = next;
      state.screen = screenFor(next);
    } catch {
      syncFailures += 1;
      if (syncFailures === 3) toast('Connection interrupted. Reconnecting…');
    } finally {
      pollInFlight = false;
    }
  };
  pollNow = poll;
  connectRealtime();
  void poll();
  pollTimer = window.setInterval(() => { void poll(); }, 1200);
}

async function api(path: string, data: Record<string, unknown> = {}, needsSession = true) {
  const response = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(needsSession && state.session ? { 'x-session': state.session } : {}) },
    body: JSON.stringify(data),
  });
  const result = await response.json() as { error?: string; session?: string };
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
}

async function withBusy(action: string, task: () => Promise<void>) {
  if (state.busy) return;
  state.busy = action;
  try { await task(); }
  catch (error) { toast(error instanceof Error ? error.message : 'Something went wrong.'); }
  finally { state.busy = ''; }
}

async function enterRoom(path: string, data: Record<string, unknown>) {
  try {
    const result = await api(path, data, false);
    state.session = result.session || '';
    localStorage.setItem('same-brain-session', state.session);
    state.draft = '';
    state.error = '';
    await sync();
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Something went wrong.';
  }
}

function navigate(screen: Screen) {
  state.screen = screen;
  state.error = '';
}

function initials(name: string) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function home() {
  stopStream();
  state.session = '';
  state.room = null;
  state.draft = '';
  state.screen = 'home';
  localStorage.removeItem('same-brain-session');
  history.replaceState(null, '', location.pathname);
}

async function submitCreate(event: Event) {
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  await withBusy('create', () => enterRoom('create', { name: data.get('name'), questions: state.questions, seconds: state.seconds }));
}

async function submitJoin(event: Event) {
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  await withBusy('join', () => enterRoom('join', { name: data.get('name'), code: data.get('code') }));
}

async function submitQuick(event: Event) {
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  await withBusy('quick', () => enterRoom('quickplay', { name: data.get('name') }));
}

async function submitAnswer(event: Event) {
  event.preventDefault();
  await withBusy('submit', async () => {
    await api('submit', { answer: state.draft });
    state.draft = '';
    await pollNow?.();
  });
}

async function startGame() {
  await withBusy('start', async () => { await api('start'); await pollNow?.(); });
}

async function rematch() {
  await withBusy('rematch', async () => { await api('rematch'); await pollNow?.(); });
}

async function copyText(value: string, message: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast(message);
  } catch { toast('Could not copy. Please try again.'); }
}

watch(() => state.draft, (answer, _previous, onCleanup) => {
  if (!state.session) return;
  draftTimer = window.setTimeout(() => { void api('draft', { answer }).catch(() => {}); }, 500);
  onCleanup(() => window.clearTimeout(draftTimer));
});

onMounted(() => {
  tickTimer = window.setInterval(() => { state.now = Date.now(); }, 250);
  if (state.session) {
    state.screen = 'lobby';
    void sync();
  } else {
    state.screen = inviteCode ? 'join' : 'home';
  }
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);
});

function onOnline() { void pollNow?.(); }
function onVisibility() { if (!document.hidden) void pollNow?.(); }

onBeforeUnmount(() => {
  stopStream();
  window.clearInterval(tickTimer);
  window.clearTimeout(draftTimer);
  window.clearTimeout(toastTimer);
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" aria-label="Same Brain home" @click="home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i></span>
        <span>same brain</span>
      </button>
      <button class="how-link" @click="howDialog?.showModal()">How to play <span aria-hidden="true">↗</span></button>
    </header>

    <main id="app" class="main-content" aria-live="polite">
      <Transition mode="out-in" name="screen">
        <section v-if="state.screen === 'home'" key="home" class="screen hero">
          <div class="hero-copy">
            <div class="eyebrow">A PARTY GAME FOR YOUR GROUP CHAT</div>
            <h1>Think alike.<br /><em>Win together-ish.</em></h1>
            <p>Same question. Six different brains. Somehow, the same answer.</p>
            <div class="actions">
              <button class="button primary" @click="navigate('create')"><span class="action-icon">＋</span>Create a game</button>
              <button class="button secondary" @click="navigate('quick')"><span class="action-icon" style="background:#eeeee8;color:#555">↗</span>Quick play</button>
              <button class="button subtle" @click="navigate('join')">Join with a room code</button>
            </div>
            <p class="hero-note">No accounts, no downloads. Just your people and one shared brain cell.</p>
          </div>
          <div class="art-stage" aria-hidden="true"><div class="orbit"></div><div class="confetti-dot"></div><div class="confetti-spark">✳</div><div class="brain-card"><span class="brain-illustration">🧠</span></div><div class="float-tag tag-one">“<b>Pizza</b>”</div><div class="float-tag tag-two">“<b>Pizza</b>”</div></div>
        </section>

        <section v-else-if="state.screen === 'create'" key="create" class="screen narrow">
          <div class="form-head"><button class="back-link" @click="navigate('home')">← &nbsp;Back</button><h1 class="title">Set the scene</h1><p class="lead">A few friends, a few questions, and a suspicious amount of mind reading.</p></div>
          <form class="form-stack" @submit.prevent="submitCreate">
            <label><span class="field-label">Your nickname</span><input class="text-input" name="name" maxlength="18" placeholder="What should we call you?" autocomplete="nickname" required /></label>
            <div><span class="field-label">Number of questions</span><div class="segmented"><button v-for="value in [3, 5, 10]" :key="value" type="button" class="segment" :class="{ active: value === state.questions }" :aria-pressed="value === state.questions" @click="state.questions = value">{{ value }} {{ value === 3 ? 'Quick' : value === 5 ? 'Classic' : 'Extended' }}</button></div></div>
            <div><span class="field-label">Answer timer</span><div class="segmented"><button v-for="value in [10, 15, 20]" :key="value" type="button" class="segment" :class="{ active: value === state.seconds }" :aria-pressed="value === state.seconds" @click="state.seconds = value">{{ value }} seconds</button></div></div>
            <div class="form-error">{{ state.error }}</div>
            <button class="button primary full" type="submit" :disabled="Boolean(state.busy)"><span v-if="state.busy === 'create'" class="button-spinner" aria-hidden="true"></span>{{ state.busy === 'create' ? 'Creating room…' : 'Create private room →' }}</button>
            <div class="form-tip">Your friends can join with a code or the invitation link.</div>
          </form>
        </section>

        <section v-else-if="state.screen === 'join'" key="join" class="screen narrow">
          <div class="form-head"><button class="back-link" @click="navigate('home')">← &nbsp;Back</button><h1 class="title">You’re invited</h1><p class="lead">Grab a nickname and jump into the room.</p></div>
          <form class="form-stack" @submit.prevent="submitJoin">
            <label><span class="field-label">Your nickname</span><input class="text-input" name="name" maxlength="18" placeholder="What should we call you?" autocomplete="nickname" required /></label>
            <label><span class="field-label">Room code</span><input v-model="joinCode" class="text-input" name="code" maxlength="6" placeholder="e.g. BRN482" autocapitalize="characters" required /></label>
            <div class="form-error">{{ state.error }}</div>
            <button class="button primary full" type="submit" :disabled="Boolean(state.busy)"><span v-if="state.busy === 'join'" class="button-spinner" aria-hidden="true"></span>{{ state.busy === 'join' ? 'Joining room…' : 'Join room →' }}</button>
          </form>
        </section>

        <section v-else-if="state.screen === 'quick'" key="quick" class="screen narrow">
          <div class="form-head"><button class="back-link" @click="navigate('home')">← &nbsp;Back</button><h1 class="title">Find your people</h1><p class="lead">We’ll gather a few brains and start a public match.</p></div>
          <form class="form-stack" @submit.prevent="submitQuick">
            <label><span class="field-label">Your nickname</span><input class="text-input" name="name" maxlength="18" placeholder="What should we call you?" autocomplete="nickname" required /></label>
            <div class="form-error">{{ state.error }}</div>
            <button class="button primary full" type="submit" :disabled="Boolean(state.busy)"><span v-if="state.busy === 'quick'" class="button-spinner" aria-hidden="true"></span>{{ state.busy === 'quick' ? 'Finding a match…' : 'Find a match →' }}</button>
            <div class="form-tip">Public matches use 5 questions and a 15 second timer.</div>
          </form>
        </section>

        <section v-else-if="state.screen === 'lobby' && room" key="lobby" class="screen room">
          <div class="room-heading"><div><div class="room-id"><span class="status-dot"></span>{{ room.mode === 'public' ? 'PUBLIC MATCH' : 'PRIVATE ROOM' }}</div><h1 class="title">{{ room.state === 'NO_MATCH' ? 'No match found' : room.mode === 'public' ? 'Finding your people' : 'The hangout' }}</h1><p class="lead">{{ room.state === 'NO_MATCH' ? 'No one joined this time. Give Quick Play another try.' : room.mode === 'public' ? 'Your match will start as soon as everyone is ready.' : 'Send the invite. The more brains, the better.' }}</p></div></div>
          <div class="room-code-box"><div><div class="room-code-label">Room code</div><div class="room-code">{{ room.roomCode }}</div></div><button class="copy-button" @click="copyText(room.roomCode, 'Room code copied.')">Copy code</button><button class="copy-button" @click="copyText(inviteUrl, 'Invite link copied.')">Share invite</button></div>
          <div class="room-layout"><div><p class="section-label">Players <span style="color:#c0bbb2">{{ room.players.length }}/6</span></p><div class="player-grid"><template v-for="index in 6" :key="index"><div v-if="room.players[index - 1]" class="player-tile"><span class="avatar" :style="{ background: room.players[index - 1].color }">{{ initials(room.players[index - 1].name) }}</span><span style="min-width:0"><span class="player-name">{{ room.players[index - 1].name }}{{ room.players[index - 1].id === room.playerId ? ' (you)' : '' }}</span><span v-if="room.players[index - 1].id === room.hostId" class="host-label">HOST</span></span></div><div v-else class="empty-slot">+ &nbsp; Open seat</div></template></div></div>
            <aside class="settings-panel"><p class="section-label">Game settings</p><div class="setting-row"><span>Questions</span><b>{{ room.config.questions }}</b></div><div class="setting-row"><span>Answer time</span><b>{{ room.config.seconds }} sec</b></div><div class="setting-row"><span>Match length</span><b>~{{ Math.round(room.config.questions * (room.config.seconds + 10) / 60) }} min</b></div>
              <div class="room-controls"><button v-if="room.state === 'NO_MATCH'" class="button primary" @click="home">Back to home</button><button v-else-if="room.mode === 'public'" class="button primary" disabled>Finding players…</button><template v-else-if="room.playerId === room.hostId"><button class="button primary" :disabled="room.players.filter(player => player.connected).length < 2 || Boolean(state.busy)" @click="startGame"><span v-if="state.busy === 'start'" class="button-spinner" aria-hidden="true"></span>{{ state.busy === 'start' ? 'Starting…' : 'Start game →' }}</button><p class="waiting-copy">{{ room.players.length < 2 ? 'Need one more brain to get started.' : 'Everyone in? Let’s go.' }}</p></template><p v-else class="waiting-copy">Waiting for the host to start…</p></div>
            </aside>
          </div>
        </section>

        <section v-else-if="state.screen === 'game' && room?.question" key="game" class="screen">
          <section v-if="countdown" class="screen countdown-screen"><div class="eyebrow">QUESTION {{ room.round }} OF {{ room.config.questions }}</div><div class="count-number">{{ countdownNumber }}</div><h2>Ready to sync?</h2><p>Same question, coming right up.</p></section>
          <section v-else class="screen game-wrap"><div class="game-meta"><span>QUESTION {{ room.round }} OF {{ room.config.questions }}</span><span class="timer" :class="{ urgent: remaining <= 5 }">{{ timerLabel }}</span></div>
            <div class="question-card"><div class="eyebrow">{{ room.question.category }} · THINK FAST</div><h1 class="question">{{ room.question.text }}</h1></div>
            <div v-if="room.ownSubmitted" class="waiting-box"><span class="lock-icon">🔒</span> Answer locked! Let’s see who thinks like you.</div>
            <form v-else class="answer-form" @submit="submitAnswer"><input v-model="state.draft" class="text-input" name="answer" maxlength="30" autocomplete="off" placeholder="Type your answer…" :disabled="remaining === 0 || Boolean(state.busy)" autofocus /><button class="button primary" type="submit" :disabled="remaining === 0 || Boolean(state.busy)"><span v-if="state.busy === 'submit'" class="button-spinner" aria-hidden="true"></span>{{ state.busy === 'submit' ? 'Submitting…' : 'Lock it in ↗' }}</button></form>
            <div v-if="!room.ownSubmitted" class="answer-hint">30 characters max · your answer stays secret</div>
            <div class="submitted-meter"><div class="meter-top"><span>Brains locked in</span><span>{{ room.submittedCount }} / {{ room.players.length }}</span></div><div class="meter-track"><div class="meter-fill" :style="{ width: `${submittedPercent}%` }"></div></div></div>
          </section>
        </section>

        <section v-else-if="state.screen === 'reveal' && room" key="reveal" class="screen reveal-screen"><div class="reveal-top"><div class="eyebrow">QUESTION {{ room.round }} RESULTS</div><h1 class="title">Who had the same brain?</h1><p class="question-small">{{ room.question?.text }}</p></div>
          <div v-if="room.reveal?.length" class="group-grid"><article v-for="group in room.reveal" :key="group.answer" class="answer-group"><div class="group-answer">{{ group.answer }}</div><div class="group-people"><span v-for="person in group.players" :key="person.id" class="mini-person"><span class="mini-avatar" :style="{ background: person.color }">{{ initials(person.name) }}</span>{{ person.name }}</span></div><div class="points"><b v-if="group.players.length > 1">+{{ group.points }} points each</b><template v-else>No match this time</template></div></article></div>
          <div v-else class="no-matches">No one answered this round. The brain cell is taking a quick break.</div>
          <div class="reveal-board"><span>Scoreboard</span><div class="compact-scores"><span v-for="(player, index) in rankedPlayers" :key="player.id" class="compact-score">{{ index + 1 }}. {{ player.name }}<b>{{ player.score }}</b></span></div></div>
        </section>

        <section v-else-if="state.screen === 'results' && room" key="results" class="screen results-screen"><div class="winner-crown">{{ winnerTied ? '✳' : '♛' }}</div><div class="eyebrow">{{ winnerTied ? 'A VERY SAME-BRAIN FINISH' : 'THE BRAINIEST BRAIN' }}</div><h1 class="winner-name">{{ winnerTied ? 'It’s a tie!' : `${winner?.name} wins!` }}</h1><div class="winner-points">{{ winnerTied ? winnerNames : winner?.score }} {{ winnerTied ? '' : 'points' }}</div>
          <table class="results-table"><thead><tr><th>#</th><th>Player</th><th>Matches</th><th style="text-align:right">Score</th></tr></thead><tbody><tr v-for="(player, index) in rankedPlayers" :key="player.id"><td class="rank">{{ String(index + 1).padStart(2, '0') }}</td><td><span style="display:inline-flex;align-items:center;gap:8px"><span class="mini-avatar" :style="{ background: player.color }">{{ initials(player.name) }}</span>{{ player.name }}{{ winners.includes(player.id) ? ' ✦' : '' }}</span></td><td>{{ player.matches }}</td><td class="score-cell">{{ player.score }}</td></tr></tbody></table>
          <div class="results-actions"><button v-if="room.playerId === room.hostId" class="button primary" :disabled="Boolean(state.busy)" @click="rematch"><span v-if="state.busy === 'rematch'" class="button-spinner" aria-hidden="true"></span>{{ state.busy === 'rematch' ? 'Starting rematch…' : 'Play again ↻' }}</button><button v-else class="button secondary" disabled>Waiting for host…</button><button class="button secondary" @click="home">Back to home</button></div><div class="small-note">A fresh set of questions, same good company.</div>
        </section>
      </Transition>
    </main>
    <footer class="footer"><span>Made for people who finish each other&apos;s</span><span class="footer-dot">thoughts.</span></footer>
    <Transition name="toast"><div v-if="state.toast" class="toast show" role="status">{{ state.toast }}</div></Transition>
    <dialog ref="howDialog" class="how-dialog" @click="($event.target === $event.currentTarget) && howDialog?.close()"><button class="dialog-close" aria-label="Close" @click="howDialog?.close()">×</button><div class="eyebrow">THE WHOLE IDEA</div><h2>Think alike.<br />Win together-ish.</h2><p>Everyone gets the same question. Type the answer you think someone else will choose.</p><p>A match earns points, but a smaller matching group earns more. So go with your gut, then see whose brain took the same turn.</p><div class="scoring"><span>2 alike <b>100 pts</b></span><span>3 alike <b>70 pts</b></span><span>4 alike <b>50 pts</b></span></div><button class="button primary full" @click="howDialog?.close()">Got it</button></dialog>
  </div>
</template>
