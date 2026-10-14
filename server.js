import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join } from 'node:path';
import { Server as SocketServer } from 'socket.io';

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const rooms = new Map();
const streams = new Map();
const sessions = new Map();
const rateBuckets = new Map();
let io = null;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const bank = [
  ['Everyday', 'Name something people always forget.'], ['Everyday', 'What is the first thing people do after waking up?'], ['Everyday', 'Name something you would never lend to a stranger.'], ['Everyday', 'What belongs in every refrigerator?'], ['Everyday', 'Name something people do when they are nervous.'],
  ['Everyday', 'What do people lose around the house?'], ['Everyday', 'Name something you bring on a road trip.'], ['Everyday', 'What is the best thing to eat for breakfast?'], ['Everyday', 'Name something that takes too long.'], ['Everyday', 'What do people do while waiting in line?'],
  ['Everyday', 'Name something you keep in a junk drawer.'], ['Everyday', 'What is the first thing you unpack after a trip?'], ['Everyday', 'Name something people do before bed.'], ['Everyday', 'What is a reason to be late?'], ['Everyday', 'Name something you would find in a backpack.'],
  ['Everyday', 'What is the hardest chore to avoid?'], ['Everyday', 'Name a sound you hear every day.'], ['Everyday', 'What do people buy when they are hungry?'], ['Everyday', 'Name something that is always running out.'], ['Everyday', 'What is something people check too often?'],
  ['Everyday', 'Name something you would pack for a picnic.'], ['Everyday', 'What is the coziest thing to wear?'], ['Everyday', 'Name something you might find under a couch.'], ['Everyday', 'What do people do when the Wi-Fi stops working?'], ['Everyday', 'Name something you would bring to a sleepover.'],
  ['Funny', 'What is the worst thing to say on a first date?'], ['Funny', 'Name something you would not want to find in your bed.'], ['Funny', 'What is the worst birthday gift?'], ['Funny', 'Name something embarrassing to send to your boss by mistake.'], ['Funny', 'What is something you would not want your parents to discover?'],
  ['Funny', 'What would be the worst name for a pet?'], ['Funny', 'Name something awkward to do in an elevator.'], ['Funny', 'What is the worst thing to spill on yourself?'], ['Funny', 'Name a terrible thing to shout in a library.'], ['Funny', 'What food would be weird to eat in the shower?'],
  ['Funny', 'Name something you should never put in a toaster.'], ['Funny', 'What is the least romantic place for a proposal?'], ['Funny', 'Name a bad excuse for not doing your homework.'], ['Funny', 'What would be a strange thing to collect?'], ['Funny', 'Name something that would ruin a family photo.'],
  ['Funny', 'What is the worst thing to hear from a haircut stylist?'], ['Funny', 'Name a job that would be funny for a penguin.'], ['Funny', 'What should never be served at a wedding?'], ['Funny', 'Name something you would hate to step on barefoot.'], ['Funny', 'What is a weird thing to put on a pizza?'],
  ['Random', 'What would be terrifying if it were gigantic?'], ['Random', 'What would you buy if you suddenly became rich?'], ['Random', 'Name something that should not be able to talk.'], ['Random', 'What is the strangest thing to bring to a wedding?'], ['Random', 'Name something suspicious to own one hundred of.'],
  ['Random', 'What animal would make a terrible roommate?'], ['Random', 'What would be the worst superpower?'], ['Random', 'Name something you would put in a time capsule.'], ['Random', 'What would you name a tiny planet?'], ['Random', 'Name something that would be odd to find in space.'],
  ['Random', 'What would be the funniest thing to make a statue of?'], ['Random', 'Name something you would never want to fall from the sky.'], ['Random', 'What object would be most confusing to find in the woods?'], ['Random', 'What would be a terrible flavor of ice cream?'], ['Random', 'Name something that should be illegal to juggle.'],
  ['Random', 'What would you bring to a deserted island for fun?'], ['Random', 'Name something that would be hard to explain to an alien.'], ['Random', 'What is the least useful thing to have in a submarine?'], ['Random', 'Name something that would make a bad hat.'], ['Random', 'What would be a strange thing to see a ghost doing?'],
  ['Social', 'Name a movie almost everyone has seen.'], ['Social', 'What app do people open first in the morning?'], ['Social', 'Name something associated with superheroes.'], ['Social', 'What do people pretend to enjoy?'], ['Social', 'Name something people argue about for no reason.'],
  ['Social', 'What is a popular movie snack?'], ['Social', 'Name a famous fictional villain.'], ['Social', 'What is something people post online?'], ['Social', 'Name a game people play at a party.'], ['Social', 'What is a common karaoke song?'],
  ['Social', 'Name a reason someone might cancel plans.'], ['Social', 'What is a popular thing to do on a weekend?'], ['Social', 'Name something people take photos of.'], ['Social', 'What is a trend that will come back someday?'], ['Social', 'Name a famous cartoon character.'],
  ['Social', 'What is something people brag about?'], ['Social', 'Name a common group chat name.'], ['Social', 'What do people do at a concert?'], ['Social', 'Name something you might bring to a game night.'], ['Social', 'What is a fun theme for a party?'],
  ['Food', 'Name a food that is better cold.'], ['Food', 'What is the best pizza topping?'], ['Food', 'Name a food you eat with your hands.'], ['Food', 'What snack disappears fastest at a party?'], ['Food', 'Name a food that is hard to share.'],
  ['Food', 'What is the best flavor of cake?'], ['Food', 'Name something you dip in sauce.'], ['Food', 'What is a food people eat at a movie theater?'], ['Food', 'Name a food that smells better than it looks.'], ['Food', 'What should never go on a sandwich?'],
  ['Food', 'Name a fruit you would put in a smoothie.'], ['Food', 'What is the best late-night snack?'], ['Food', 'Name a food you would bring to a potluck.'], ['Food', 'What is the best thing to eat on a rainy day?'], ['Food', 'Name something crunchy.'],
  ['Food', 'What food would you miss most on vacation?'], ['Food', 'Name a topping for ice cream.'], ['Food', 'What is a food that makes a mess?'], ['Food', 'Name a drink you would order at a cafe.'], ['Food', 'What is the best food to eat with friends?'],
  ['Places', 'Name somewhere you would go to relax.'], ['Places', 'What is the best place to take a nap?'], ['Places', 'Name somewhere you might meet a friend.'], ['Places', 'What place is always too loud?'], ['Places', 'Name somewhere you would not want to get lost.'],
  ['Places', 'Where would you go for the best view?'], ['Places', 'Name a place that smells nice.'], ['Places', 'Where would be a strange place to fall asleep?'], ['Places', 'Name somewhere you would go on a first date.'], ['Places', 'What is the most boring place to wait?'],
  ['Places', 'Name somewhere you would bring a book.'], ['Places', 'Where might you find a secret door?'], ['Places', 'Name a place you would visit in winter.'], ['Places', 'Where would you go to celebrate?'], ['Places', 'Name somewhere you would never want to work.'],
  ['Imagination', 'If your shoes could talk, what would they complain about?'], ['Imagination', 'What would a cloud keep in its pocket?'], ['Imagination', 'Name something a robot would misunderstand.'], ['Imagination', 'What would be a boring name for a dragon?'], ['Imagination', 'What would a friendly monster ask you for?'],
  ['Imagination', 'Name something that could use a tiny hat.'], ['Imagination', 'What would be the first rule on the moon?'], ['Imagination', 'What would a talking tree gossip about?'], ['Imagination', 'Name something you would teach a dinosaur.'], ['Imagination', 'What should a magic wand not turn things into?'],
  ['Imagination', 'What would be a funny thing to find in a treasure chest?'], ['Imagination', 'What would you call a pet star?'], ['Imagination', 'Name something a pirate would be afraid of.'], ['Imagination', 'What could a penguin be the mayor of?'], ['Imagination', 'What would be a surprising thing for a mermaid to collect?'],
  ['Habits', 'What do people do when they are bored?'], ['Habits', 'What is something people procrastinate?'], ['Habits', 'Name something people do in the car.'], ['Habits', 'What do people search for online?'], ['Habits', 'What is a habit people want to break?'],
  ['Habits', 'Name something people do when nobody is watching.'], ['Habits', 'What do people do during a boring meeting?'], ['Habits', 'What is something people talk about too much?'], ['Habits', 'Name something people forget to charge.'], ['Habits', 'What do people do when they cannot sleep?'],
  ['Habits', 'Name something people always have in their pockets.'], ['Habits', 'What do people do to celebrate small wins?'], ['Habits', 'What is something people do on autopilot?'], ['Habits', 'Name something people avoid cleaning.'], ['Habits', 'What do people do when they get good news?'],
  ['Dreams', 'What would you wish for if you found a genie?'], ['Dreams', 'Name something you would want in your dream house.'], ['Dreams', 'What would you do with an extra day off?'], ['Dreams', 'Name something you would learn if you had a free teacher.'], ['Dreams', 'What would you do with a free plane ticket?'],
  ['Dreams', 'What is a skill you wish you had?'], ['Dreams', 'Name something you would do if you were invisible for a day.'], ['Dreams', 'What would you put in your dream backyard?'], ['Dreams', 'Name a place you would love to visit.'], ['Dreams', 'What would you do with a personal theme song?']
].map(([category, text], i) => ({ id: i + 1, category, text }));

const normalize = (answer) => {
  let key = answer.normalize('NFKC').toLocaleLowerCase().trim().replace(/[’']/g, '').replace(/[‐‑‒–—-]/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ');
  const variants = new Map([['icecream', 'ice cream'], ['soda pop', 'soda'], ['grey', 'gray'], ['colour', 'color'], ['nite', 'night'], ['tv', 'television']]);
  return variants.get(key.replace(/\s/g, '')) || variants.get(key) || key;
};
const code = () => randomBytes(3).toString('hex').toUpperCase();
const token = () => randomBytes(24).toString('base64url');
const colors = ['#ef8b70', '#8b92e8', '#64b99d', '#e0ab48', '#d67dac', '#5aa9c5'];

function playerFor(session) {
  const loc = sessions.get(session);
  if (!loc) return null;
  const room = rooms.get(loc.room);
  const player = room?.players.find(p => p.session === session);
  return room && player ? { room, player } : null;
}
function snapshot(room, viewer) {
  const base = {
    roomCode: room.code, mode: room.mode, hostId: room.hostId, config: room.config,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, score: p.score, matches: p.matches })),
    state: room.state, round: room.round, question: room.question ? { text: room.question.text, category: room.question.category, endsAt: room.endsAt, startsAt: room.startsAt } : null,
    submittedCount: room.submissions.size, playerId: viewer?.id, serverNow: Date.now()
  };
  if (room.state === 'REVEAL' || room.state === 'RESULTS') base.reveal = room.reveal;
  if (room.state === 'RESULTS') {
    const high = Math.max(...room.players.map(p => p.score));
    base.winners = room.players.filter(p => p.score === high).map(p => p.id);
  }
  base.ownSubmitted = viewer ? room.submissions.has(viewer.id) : false;
  return base;
}
function publish(room) {
  io?.to(`room:${room.code}`).emit('room:changed');
  for (const p of room.players) {
    const res = streams.get(p.session);
    if (res && !res.destroyed) res.write(`event: state\ndata: ${JSON.stringify(snapshot(room, p))}\n\n`);
  }
}
function newRoom(mode, config = {}) {
  let roomCode; do roomCode = code(); while (rooms.has(roomCode));
  const room = { code: roomCode, mode, config: { questions: config.questions || 5, seconds: config.seconds || 15 }, players: [], state: 'LOBBY', round: 0, used: [], question: null, startsAt: null, endsAt: null, submissions: new Map(), drafts: new Map(), reveal: null, timers: [] };
  rooms.set(room.code, room); return room;
}
function addPlayer(room, name) {
  if (/\b(?:fuck|shit|bitch|asshole|cunt|nigger|faggot)\b/i.test(name)) throw new Error('That nickname was blocked. Try another.');
  if (room.players.length >= 6) throw new Error('This room is full.');
  if (room.state !== 'LOBBY' && room.state !== 'RESULTS') throw new Error('This match is already in progress.');
  const session = token();
  const player = { id: token().slice(0, 8), session, name: name.trim().slice(0, 18), color: colors[room.players.length % colors.length], connected: true, score: 0, matches: 0 };
  room.players.push(player); sessions.set(session, { room: room.code });
  if (room.state === 'LOBBY' && !room.players.some(p => p.id === room.hostId && p.connected)) room.hostId = player.id;
  return { player, session };
}
function schedule(room, fn, ms) { const t = setTimeout(fn, ms); room.timers.push(t); }
function clearTimers(room) { room.timers.forEach(clearTimeout); room.timers = []; }
function beginRound(room) {
  if (room.players.filter(p => p.connected).length < 2) { room.state = 'LOBBY'; room.question = null; publish(room); return; }
  room.round += 1; room.state = 'COUNTDOWN'; room.submissions = new Map(); room.drafts = new Map(); room.reveal = null;
  const recent = room.recent || [];
  const remaining = bank.filter(q => !room.used.includes(q.id) && !recent.includes(q.id));
  const q = remaining[Math.floor(Math.random() * remaining.length)]; room.used.push(q.id); room.question = q; room.startsAt = Date.now() + 3000; room.endsAt = room.startsAt + room.config.seconds * 1000;
  publish(room);
  schedule(room, () => { if (room.state !== 'COUNTDOWN') return; room.state = 'QUESTION'; publish(room); schedule(room, () => closeRound(room), Math.max(0, room.endsAt - Date.now())); }, 3000);
}
function closeRound(room) {
  if (!['COUNTDOWN', 'QUESTION'].includes(room.state)) return;
  room.state = 'REVEAL';
  for (const p of room.players) {
    if (room.submissions.has(p.id)) continue;
    const draft = room.drafts.get(p.id)?.trim().replace(/\s+/g, ' ').slice(0, 30);
    if (draft && !/\b(?:fuck|shit|bitch|asshole|cunt|nigger|faggot)\b/i.test(draft)) room.submissions.set(p.id, { text: draft, key: normalize(draft) });
  }
  const groups = new Map();
  for (const p of room.players) {
    const answer = room.submissions.get(p.id);
    if (!answer?.key) continue;
    if (!groups.has(answer.key)) groups.set(answer.key, { key: answer.key, answer: answer.text, players: [] });
    groups.get(answer.key).players.push(p);
  }
  const pointsFor = { 2: 100, 3: 70, 4: 50, 5: 40, 6: 30 };
  room.reveal = [...groups.values()].map(g => {
    const points = pointsFor[g.players.length] || 0;
    g.players.forEach(p => { p.score += points; if (points) p.matches += 1; });
    return { answer: g.answer, players: g.players.map(p => ({ id: p.id, name: p.name, color: p.color })), points };
  });
  publish(room);
  schedule(room, () => {
    if (room.round >= room.config.questions) { room.state = 'RESULTS'; publish(room); return; }
    beginRound(room);
  }, 7000);
}
function endResponse(res, status, data) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(data)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-session' }); return res.end(); }
  if (req.method === 'GET' && url.pathname === '/api/session') {
    const found = playerFor(url.searchParams.get('session'));
    return endResponse(res, found ? 200 : 401, found ? { ok: true } : { error: 'This room session has ended.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const found = playerFor(url.searchParams.get('session'));
    if (!found) return endResponse(res, 401, { error: 'Session expired. Rejoin with your room code.' });
    found.player.connected = true;
    return endResponse(res, 200, snapshot(found.room, found.player));
  }
  if (url.pathname === '/events') {
    const session = url.searchParams.get('session'); const found = playerFor(session);
    if (!found) return endResponse(res, 401, { error: 'Session expired. Rejoin with your room code.' });
    const { room, player } = found; player.connected = true;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    res.write(`event: state\ndata: ${JSON.stringify(snapshot(room, player))}\n\n`);
    const prev = streams.get(session); if (prev && prev !== res) prev.end(); streams.set(session, res);
    publish(room);
    const beat = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 20000);
    req.on('close', () => { clearInterval(beat); if (streams.get(session) === res) streams.delete(session); setTimeout(() => { if (!streams.has(session)) { player.connected = false; if (room.state === 'LOBBY' && room.hostId === player.id) { const next = room.players.find(p => p.connected && p.id !== player.id); if (next) room.hostId = next.id; } const active = room.players.filter(p => p.connected).length; if (!active) { clearTimers(room); rooms.delete(room.code); room.players.forEach(p => sessions.delete(p.session)); return; } if (['COUNTDOWN', 'QUESTION', 'REVEAL'].includes(room.state) && active < 2) { clearTimers(room); room.state = 'RESULTS'; } publish(room); } }, 12000); });
    return;
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now();
    const bucket = rateBuckets.get(ip) || { start: now, count: 0 };
    if (now - bucket.start > 60000) { bucket.start = now; bucket.count = 0; }
    bucket.count += 1; rateBuckets.set(ip, bucket);
    if (bucket.count > 360) return endResponse(res, 429, { error: 'Too many requests. Take a breath and try again.' });
    let body = ''; for await (const chunk of req) body += chunk;
    let data; try { data = JSON.parse(body || '{}'); } catch { return endResponse(res, 400, { error: 'Invalid request.' }); }
    try {
      let room, player, session;
      if (url.pathname === '/api/create') {
        const name = String(data.name || '').trim(); if (!name) throw new Error('Add a nickname first.');
        room = newRoom('private', { questions: [3, 5, 10].includes(+data.questions) ? +data.questions : 5, seconds: [10, 15, 20].includes(+data.seconds) ? +data.seconds : 15 });
        ({ player, session } = addPlayer(room, name)); room.hostId = player.id; publish(room);
        return endResponse(res, 200, { session, code: room.code });
      }
      if (url.pathname === '/api/join') {
        const name = String(data.name || '').trim(), roomCode = String(data.code || '').trim().toUpperCase();
        if (!name) throw new Error('Add a nickname first.'); room = rooms.get(roomCode); if (!room) throw new Error('We could not find that room code.');
        ({ player, session } = addPlayer(room, name)); publish(room); return endResponse(res, 200, { session, code: room.code });
      }
      if (url.pathname === '/api/quickplay') {
        const name = String(data.name || '').trim(); if (!name) throw new Error('Add a nickname first.');
        room = [...rooms.values()].find(r => r.mode === 'public' && r.state === 'LOBBY' && r.players.length < 6 && Date.now() - r.createdAt < 15000);
        if (!room) { room = newRoom('public'); room.createdAt = Date.now(); }
        ({ player, session } = addPlayer(room, name)); if (room.players.length === 1) room.hostId = player.id; publish(room);
        if (!room.matchTimer) room.matchTimer = setTimeout(() => {
          if (room.state !== 'LOBBY') return;
          if (room.players.length >= 2) startGame(room);
          else room.matchTimer = setTimeout(() => { if (room.state === 'LOBBY' && room.players.length >= 2) startGame(room); else if (room.state === 'LOBBY') { room.state = 'NO_MATCH'; publish(room); } }, 8000);
        }, 7000);
        return endResponse(res, 200, { session, code: room.code });
      }
      session = req.headers['x-session']; const found = playerFor(session); if (!found) throw new Error('Your session has expired.'); ({ room, player } = found); player.connected = true;
      if (url.pathname === '/api/start') {
        if (player.id !== room.hostId) throw new Error('Only the host can start this game.');
        if (room.state !== 'LOBBY') throw new Error('This game has already started.');
        if (room.players.filter(p => p.connected).length < 2) throw new Error('Invite at least one more player to start.');
        startGame(room); return endResponse(res, 200, { ok: true });
      }
      if (url.pathname === '/api/submit') {
        if (!['QUESTION', 'COUNTDOWN'].includes(room.state) || Date.now() < room.startsAt) throw new Error('This answer window has closed.');
        if (Date.now() > room.endsAt) { closeRound(room); throw new Error('The timer ran out.'); }
        if (room.submissions.has(player.id)) throw new Error('Your answer is already locked.');
        const answer = String(data.answer || '').normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 30);
        if (!answer) throw new Error('Type an answer before submitting.');
        if (/\b(?:fuck|shit|bitch|asshole|cunt|nigger|faggot)\b/i.test(answer)) throw new Error('That answer was blocked. Try another.');
        room.submissions.set(player.id, { text: answer, key: normalize(answer) });
        room.drafts.delete(player.id);
        if (room.players.filter(p => p.connected).every(p => room.submissions.has(p.id))) closeRound(room); else publish(room);
        return endResponse(res, 200, { ok: true });
      }
      if (url.pathname === '/api/draft') {
        if (!['QUESTION', 'COUNTDOWN'].includes(room.state) || Date.now() >= room.endsAt || room.submissions.has(player.id)) return endResponse(res, 200, { ok: true });
        const draft = String(data.answer || '').normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 30);
        room.drafts.set(player.id, draft);
        return endResponse(res, 200, { ok: true });
      }
      if (url.pathname === '/api/rematch') {
        if (player.id !== room.hostId) throw new Error('Only the host can start a rematch.');
        if (room.state !== 'RESULTS') throw new Error('The match is still in progress.');
        if (room.rematchStarted) throw new Error('The rematch is already starting.');
        room.rematchStarted = true; clearTimers(room); room.recent = [...(room.recent || []), ...room.used].slice(-30); room.used = []; room.round = 0; room.reveal = null; room.submissions.clear(); room.players.forEach(p => { p.score = 0; p.matches = 0; }); room.state = 'LOBBY'; room.players = room.players.filter(p => p.connected);
        room.hostId = room.players[0]?.id; room.config.questions = room.config.questions; room.rematchStarted = false; publish(room);
        return endResponse(res, 200, { ok: true });
      }
      return endResponse(res, 404, { error: 'Not found.' });
    } catch (error) { return endResponse(res, 400, { error: error.message || 'Something went wrong.' }); }
  }
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!/^\/(?:index\.html|socket\.io\.min\.js|assets\/[A-Za-z0-9._-]+\.(?:js|css))$/.test(path)) { res.writeHead(404); return res.end('Not found'); }
  try { const contents = await readFile(join(root, 'public', path.replace(/^\//, ''))); res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }); res.end(contents); }
  catch { res.writeHead(404); res.end('Not found'); }
});

function startGame(room) { clearTimers(room); room.used = []; room.round = 0; room.players.forEach(p => { p.score = 0; p.matches = 0; }); beginRound(room); }
export { bank };
if (!process.env.VERCEL) {
  io = new SocketServer(server, { path: '/api/socket-io/socket.io', transports: ['websocket'] });
  io.use((socket, next) => {
    const found = playerFor(socket.handshake.auth?.session);
    if (!found) return next(new Error('This room session has ended.'));
    socket.data.roomCode = found.room.code;
    next();
  });
  io.on('connection', socket => {
    socket.join(`room:${socket.data.roomCode}`);
    socket.emit('room:changed');
  });
  server.listen(port, '0.0.0.0', () => console.log(`Same Brain is running at http://localhost:${port}`));
}
