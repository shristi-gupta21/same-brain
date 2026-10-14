import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue';
import type { Room, Screen, SetupValues } from '../types/game';
import { countdownSeconds, formatTimer, matchPercent, rankPlayers, remainingSeconds, screenForRoom } from '../utils/game';

type ApiResult = { session?: string; error?: string };

export function useSameBrain() {
  const inviteCode = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';
  const state = reactive({
    session: localStorage.getItem('same-brain-session') || '',
    room: null as Room | null,
    screen: 'home' as Screen,
    questions: 5,
    seconds: 15,
    draft: '',
    joinCode: inviteCode,
    offset: 0,
    error: '',
    busy: '',
    toast: '',
    now: Date.now(),
  });

  let socket: ReturnType<NonNullable<Window['io']>> | null = null;
  let pollTimer: number | undefined;
  let tickTimer: number | undefined;
  let draftTimer: number | undefined;
  let toastTimer: number | undefined;
  let pollTail: Promise<void> = Promise.resolve();
  let pollGeneration = 0;
  let socketWarned = false;
  let syncFailures = 0;
  let pollNow: (() => Promise<void>) | null = null;
  let previousSnapshot = '';

  const remaining = computed(() => remainingSeconds(state.room, state.now, state.offset));
  const countdown = computed(() => {
    const question = state.room?.question;
    return state.room?.state === 'COUNTDOWN' && Boolean(question) && state.now + state.offset < (question?.startsAt || 0);
  });
  const countdownNumber = computed(() => countdownSeconds(state.room, state.now, state.offset));
  const timerLabel = computed(() => formatTimer(remaining.value));
  const submittedPercent = computed(() => matchPercent(state.room));
  const rankedPlayers = computed(() => rankPlayers(state.room?.players || []));
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

  function stopSync() {
    socket?.disconnect();
    socket = null;
    window.clearInterval(pollTimer);
    pollTimer = undefined;
    pollNow = null;
    pollGeneration += 1;
    pollTail = Promise.resolve();
  }

  function home() {
    stopSync();
    state.session = '';
    state.room = null;
    state.draft = '';
    state.screen = 'home';
    localStorage.removeItem('same-brain-session');
    history.replaceState(null, '', location.pathname);
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
    stopSync();
    if (!state.session) return;
    previousSnapshot = '';
    const generation = pollGeneration;

    const fetchState = async () => {
      const session = state.session;
      const generation = pollGeneration;
      if (!session) return;
      try {
        const response = await fetch(`/api/state?session=${encodeURIComponent(session)}`, { cache: 'no-store' });
        if (state.session !== session || generation !== pollGeneration) return;
        if (response.status === 401) {
          home();
          toast('That room session has ended. You can start a fresh game.');
          return;
        }
        if (!response.ok) throw new Error(`Sync failed (${response.status}).`);

        const next = await response.json() as Room;
        if (state.session !== session || generation !== pollGeneration) return;
        if (syncFailures >= 3) toast('Connection restored.');
        syncFailures = 0;
        state.offset = next.serverNow - Date.now();

        // Ignore the server clock field so unchanged snapshots do not trigger needless UI updates.
        const comparable = { ...next } as Partial<Room>;
        delete comparable.serverNow;
        const serialized = JSON.stringify(comparable);
        if (serialized === previousSnapshot) return;
        previousSnapshot = serialized;

        const previous = state.room;
        const newQuestion = previous?.round !== next.round || previous?.question?.text !== next.question?.text;
        if ((previous?.state !== next.state && next.state === 'QUESTION') || newQuestion) {
          if (next.state === 'QUESTION' || next.state === 'COUNTDOWN') state.draft = '';
        }
        state.room = next;
        state.screen = screenForRoom(next);
      } catch {
        if (state.session !== session || generation !== pollGeneration) return;
        syncFailures += 1;
        if (syncFailures === 3) toast('Connection interrupted. Reconnecting…');
      }
    };

    // Each caller waits for a fetch that starts after it asked. Skipping an in-flight poll
    // let the button leave its loading state before the screen had the new room.
    const poll = () => {
      const run = pollTail.then(fetchState, fetchState);
      pollTail = run.then(() => undefined, () => undefined);
      return run;
    };

    pollNow = poll;
    connectRealtime();
    await poll();
    if (!state.session || generation !== pollGeneration) return;
    pollTimer = window.setInterval(() => { void poll(); }, 1200);
  }

  async function api(path: string, data: Record<string, unknown> = {}, needsSession = true): Promise<ApiResult> {
    const response = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(needsSession && state.session ? { 'x-session': state.session } : {}) },
      body: JSON.stringify(data),
    });
    const result = await response.json() as ApiResult;
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

  async function enterRoom(path: string, values: Record<string, unknown>) {
    try {
      const result = await api(path, values, false);
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

  function createRoom(values: SetupValues) {
    return withBusy('create', () => enterRoom('create', { ...values, questions: state.questions, seconds: state.seconds }));
  }

  function joinRoom(values: SetupValues) {
    return withBusy('join', () => enterRoom('join', values));
  }

  function quickPlay(values: SetupValues) {
    return withBusy('quick', () => enterRoom('quickplay', values));
  }

  function submitAnswer() {
    return withBusy('submit', async () => {
      await api('submit', { answer: state.draft });
      state.draft = '';
      await pollNow?.();
    });
  }

  function startGame() {
    return withBusy('start', async () => { await api('start'); await pollNow?.(); });
  }

  function rematch() {
    return withBusy('rematch', async () => { await api('rematch'); await pollNow?.(); });
  }

  async function copyText(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(message);
    } catch { toast('Could not copy. Please try again.'); }
  }

  function onOnline() { void pollNow?.(); }
  function onVisibility() { if (!document.hidden) void pollNow?.(); }

  // Drafts are persisted for server-side auto-submit, with a debounce to avoid a request per keystroke.
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

  onBeforeUnmount(() => {
    stopSync();
    window.clearInterval(tickTimer);
    window.clearTimeout(draftTimer);
    window.clearTimeout(toastTimer);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
  });

  return {
    state,
    remaining,
    countdown,
    countdownNumber,
    timerLabel,
    submittedPercent,
    rankedPlayers,
    winners,
    winnerTied,
    winner,
    winnerNames,
    inviteUrl,
    home,
    navigate,
    createRoom,
    joinRoom,
    quickPlay,
    submitAnswer,
    startGame,
    rematch,
    copyText,
  };
}
