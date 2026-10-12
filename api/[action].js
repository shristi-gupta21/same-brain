import { randomBytes } from 'node:crypto';
import { bank } from '../server.js';

const colors = ['#ef8b70', '#8b92e8', '#64b99d', '#e0ab48', '#d67dac', '#5aa9c5'];
const badWords = /\b(?:fuck|shit|bitch|asshole|cunt|nigger|faggot)\b/i;
const scoreTable = { 2: 100, 3: 70, 4: 50, 5: 40, 6: 30 };
const roomTtl = 3600;
const sessionTtl = 86400;
// Mobile browsers can suspend background tabs for a while; do not treat a
// missed poll as a departed player after only a few seconds.
const disconnectGrace = 120000;

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
const token = () => randomBytes(24).toString('base64url');
const generateCode = () => randomBytes(3).toString('hex').toUpperCase();
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...args) {
  if (!redisUrl || !redisToken) throw Object.assign(new Error('Room storage is not connected yet.'), { status: 503 });
  const response = await fetch(redisUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${redisToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(args)
  });
  const body = await response.json();
  if (!response.ok || body.error) throw Object.assign(new Error('Room storage is temporarily unavailable.'), { status: 503 });
  return body.result;
}

const getRoom = async code => {
  const value = await redis('GET', `room:${code}`);
  return value ? JSON.parse(value) : null;
};
const saveRoom = (room, ttl = roomTtl) => redis('SET', `room:${room.code}`, JSON.stringify(room), 'EX', ttl);
const findSession = async session => {
  if (!session) return null;
  const value = await redis('GET', `session:${session}`);
  return value ? JSON.parse(value) : null;
};

async function withLock(key, callback) {
  const lockKey = `lock:${key}`;
  const lockToken = token();
  let acquired = false;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const result = await redis('SET', lockKey, lockToken, 'NX', 'PX', 5000);
    if (result === 'OK') { acquired = true; break; }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  if (!acquired) throw Object.assign(new Error('This room is busy. Please try again.'), { status: 503 });
  try { return await callback(); }
  finally {
    await redis('EVAL', "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", '1', lockKey, lockToken).catch(() => {});
  }
}

function normalize(answer) {
  const key = answer.normalize('NFKC').toLocaleLowerCase().trim()
    .replace(/[’']/g, '').replace(/[‐‑‒–—-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ');
  const variants = new Map([['icecream', 'ice cream'], ['sodapop', 'soda'], ['grey', 'gray'], ['colour', 'color'], ['nite', 'night'], ['tv', 'television']]);
  return variants.get(key.replace(/\s/g, '')) || variants.get(key) || key;
}

function refreshPresence(room, now) {
  for (const player of room.players) player.connected = now - player.lastSeen < disconnectGrace;
  if (room.state === 'LOBBY' && !room.players.some(player => player.id === room.hostId && player.connected)) {
    room.hostId = room.players.find(player => player.connected)?.id || null;
  }
}

function beginRound(room, now) {
  const active = room.players.filter(player => player.connected);
  if (active.length < 2) {
    room.state = 'RESULTS';
    room.question = null;
    room.reveal = [];
    return;
  }
  room.round += 1;
  room.state = 'COUNTDOWN';
  room.submissions = {};
  room.drafts = {};
  room.reveal = null;
  const recent = room.recent || [];
  const choices = bank.filter(question => !room.used.includes(question.id) && !recent.includes(question.id));
  const question = choices[Math.floor(Math.random() * choices.length)];
  room.used.push(question.id);
  room.question = { id: question.id, text: question.text, category: question.category };
  room.startsAt = now + 3000;
  room.endsAt = room.startsAt + room.config.seconds * 1000;
}

function closeRound(room, now) {
  if (!['COUNTDOWN', 'QUESTION'].includes(room.state)) return;
  for (const player of room.players) {
    if (room.submissions[player.id]) continue;
    const draft = String(room.drafts[player.id] || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (draft && !badWords.test(draft)) room.submissions[player.id] = { text: draft, key: normalize(draft) };
  }
  const groups = new Map();
  for (const player of room.players) {
    const answer = room.submissions[player.id];
    if (!answer?.key) continue;
    if (!groups.has(answer.key)) groups.set(answer.key, { answer: answer.text, players: [] });
    groups.get(answer.key).players.push(player);
  }
  room.reveal = [...groups.values()].map(group => {
    const points = scoreTable[group.players.length] || 0;
    group.players.forEach(player => { player.score += points; if (points) player.matches += 1; });
    return { answer: group.answer, players: group.players.map(({ id, name, color }) => ({ id, name, color })), points };
  });
  room.state = 'REVEAL';
  room.revealUntil = now + 7000;
}

function advance(room, now) {
  refreshPresence(room, now);
  const active = room.players.filter(player => player.connected);
  if (['COUNTDOWN', 'QUESTION', 'REVEAL'].includes(room.state) && active.length < 2) {
    room.state = 'RESULTS';
    room.reveal = room.reveal || [];
    return;
  }
  if (room.mode === 'public' && room.state === 'LOBBY') {
    if (now >= room.matchAt && active.length >= 2) startGame(room, now);
    else if (now >= room.matchDeadline) room.state = 'NO_MATCH';
  }
  if (room.state === 'COUNTDOWN' && now >= room.startsAt) room.state = 'QUESTION';
  if (room.state === 'QUESTION' && (now >= room.endsAt || active.every(player => room.submissions[player.id]))) closeRound(room, now);
  if (room.state === 'REVEAL' && now >= room.revealUntil) {
    if (room.round >= room.config.questions) room.state = 'RESULTS';
    else beginRound(room, now);
  }
}

function startGame(room, now) {
  room.used = [];
  room.round = 0;
  room.players.forEach(player => { player.score = 0; player.matches = 0; });
  beginRound(room, now);
}

function snapshot(room, viewer) {
  const result = {
    roomCode: room.code, mode: room.mode, hostId: room.hostId, config: room.config,
    players: room.players.map(({ id, name, color, connected, score, matches }) => ({ id, name, color, connected, score, matches })),
    state: room.state, round: room.round,
    question: room.question ? { text: room.question.text, category: room.question.category, endsAt: room.endsAt, startsAt: room.startsAt } : null,
    submittedCount: Object.keys(room.submissions).length, playerId: viewer.id, serverNow: Date.now(),
    ownSubmitted: Boolean(room.submissions[viewer.id])
  };
  if (room.state === 'REVEAL' || room.state === 'RESULTS') result.reveal = room.reveal || [];
  if (room.state === 'RESULTS' && room.players.length) {
    const high = Math.max(...room.players.map(player => player.score));
    result.winners = room.players.filter(player => player.score === high).map(player => player.id);
  }
  return result;
}

async function newRoom(mode, config = {}) {
  let roomCode;
  do { roomCode = generateCode(); } while (await redis('EXISTS', `room:${roomCode}`));
  const now = Date.now();
  const room = {
    code: roomCode, mode, config: { questions: config.questions || 5, seconds: config.seconds || 15 },
    players: [], state: 'LOBBY', round: 0, used: [], recent: [], question: null,
    startsAt: null, endsAt: null, submissions: {}, drafts: {}, reveal: null,
    createdAt: now, matchAt: now + 7000, matchDeadline: now + 15000
  };
  return room;
}

function validateName(value) {
  const name = String(value || '').trim().slice(0, 18);
  if (!name) throw new Error('Add a nickname first.');
  if (badWords.test(name)) throw new Error('That nickname was blocked. Try another.');
  return name;
}

async function addPlayer(room, value) {
  const name = validateName(value);
  if (room.players.length >= 6) throw new Error('This room is full.');
  if (room.state !== 'LOBBY' && room.state !== 'RESULTS') throw new Error('This match is already in progress.');
  const session = token();
  const player = { id: token().slice(0, 8), session, name, color: colors[room.players.length % colors.length], connected: true, lastSeen: Date.now(), score: 0, matches: 0 };
  room.players.push(player);
  await redis('SET', `session:${session}`, JSON.stringify({ room: room.code, playerId: player.id }), 'EX', sessionTtl);
  if (room.state === 'LOBBY' && !room.players.some(item => item.id === room.hostId && item.connected)) room.hostId = player.id;
  return { player, session };
}

async function withPlayerRoom(session, callback) {
  const location = await findSession(session);
  if (!location) throw new Error('Your session has expired.');
  return withLock(`room:${location.room}`, async () => {
    const room = await getRoom(location.room);
    if (!room) throw new Error('This room has ended.');
    const player = room.players.find(item => item.id === location.playerId && item.session === session);
    if (!player) throw new Error('Your session has expired.');
    const now = Date.now();
    player.lastSeen = now;
    player.connected = true;
    advance(room, now);
    try {
      const result = await callback(room, player, now);
      await saveRoom(room);
      return result;
    } catch (error) {
      await saveRoom(room);
      throw error;
    }
  });
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let value = '';
  for await (const chunk of req) value += chunk;
  try { return JSON.parse(value || '{}'); } catch { throw new Error('Invalid request.'); }
}

async function rateLimit(req, action) {
  if (action === 'draft') return;
  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const key = `rate:${ip}:${Math.floor(Date.now() / 60000)}`;
  const count = Number(await redis('INCR', key));
  if (count === 1) await redis('EXPIRE', key, 65);
  if (count > 180) throw Object.assign(new Error('Too many requests. Take a breath and try again.'), { status: 429 });
}

export default async function handler(req, res) {
  try {
    const action = req.query?.action || new URL(req.url, 'https://same-brain.invalid').pathname.split('/').pop();
    if (req.method === 'GET' && action === 'session') {
      const location = await findSession(new URL(req.url, 'https://same-brain.invalid').searchParams.get('session'));
      const valid = location && await getRoom(location.room);
      return json(res, valid ? 200 : 401, valid ? { ok: true } : { error: 'This room session has ended.' });
    }
    if (req.method === 'GET' && action === 'state') {
      const session = new URL(req.url, 'https://same-brain.invalid').searchParams.get('session');
      let result;
      try { result = await withPlayerRoom(session, async (room, player) => {
        if (room.mode === 'public' && room.state !== 'LOBBY') await redis('SREM', 'public:rooms', room.code);
        return snapshot(room, player);
      }); }
      catch (error) {
        if (/session has expired|room has ended/i.test(error.message)) error.status = 401;
        else error.status ||= 503;
        throw error;
      }
      return json(res, 200, result);
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
    const data = await parseBody(req);
    await rateLimit(req, action);
    if (action === 'create') {
      const name = validateName(data.name);
      const room = await newRoom('private', { questions: [3, 5, 10].includes(+data.questions) ? +data.questions : 5, seconds: [10, 15, 20].includes(+data.seconds) ? +data.seconds : 15 });
      const { player, session } = await addPlayer(room, name);
      room.hostId = player.id;
      await saveRoom(room);
      return json(res, 200, { session, code: room.code });
    }
    if (action === 'join') {
      const code = String(data.code || '').trim().toUpperCase();
      const result = await withLock(`room:${code}`, async () => {
        const room = await getRoom(code);
        if (!room) throw new Error('We could not find that room code.');
        advance(room, Date.now());
        const added = await addPlayer(room, data.name);
        await saveRoom(room);
        return { session: added.session, code: room.code };
      });
      return json(res, 200, result);
    }
    if (action === 'quickplay') {
      const name = validateName(data.name);
      const result = await withLock('quickplay', async () => {
        const roomCodes = await redis('SMEMBERS', 'public:rooms') || [];
        let room;
        for (const code of roomCodes) {
          await withLock(`room:${code}`, async () => {
            const candidate = await getRoom(code);
            if (!candidate) { await redis('SREM', 'public:rooms', code); return; }
            advance(candidate, Date.now());
            if (candidate.state !== 'LOBBY') { await saveRoom(candidate); await redis('SREM', 'public:rooms', code); return; }
            if (!room && candidate.mode === 'public' && candidate.state === 'LOBBY' && candidate.players.length < 6 && Date.now() < candidate.matchDeadline) {
              await addPlayer(candidate, name);
              room = candidate;
              await saveRoom(candidate);
            }
          });
          if (room) break;
        }
        if (!room) {
          room = await newRoom('public');
          const added = await addPlayer(room, name);
          room.hostId = added.player.id;
          await saveRoom(room);
          await redis('SADD', 'public:rooms', room.code);
          return { session: added.session, code: room.code };
        }
        const added = room.players.at(-1);
        return { session: added.session, code: room.code };
      });
      return json(res, 200, result);
    }
    const session = req.headers['x-session'];
    const result = await withPlayerRoom(session, async (room, player, now) => {
      if (action === 'start') {
        if (player.id !== room.hostId) throw new Error('Only the host can start this game.');
        if (room.state !== 'LOBBY') throw new Error('This game has already started.');
        if (room.players.filter(item => item.connected).length < 2) throw new Error('Invite at least one more player to start.');
        startGame(room, now);
        return { ok: true };
      }
      if (action === 'submit') {
        if (room.state !== 'QUESTION' || now < room.startsAt || now >= room.endsAt) throw new Error('This answer window has closed.');
        if (room.submissions[player.id]) throw new Error('Your answer is already locked.');
        const answer = String(data.answer || '').normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 30);
        if (!answer) throw new Error('Type an answer before submitting.');
        if (badWords.test(answer)) throw new Error('That answer was blocked. Try another.');
        room.submissions[player.id] = { text: answer, key: normalize(answer) };
        delete room.drafts[player.id];
        advance(room, now);
        return { ok: true };
      }
      if (action === 'draft') {
        if (room.state === 'QUESTION' && now < room.endsAt && !room.submissions[player.id]) {
          room.drafts[player.id] = String(data.answer || '').normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 30);
        }
        return { ok: true };
      }
      if (action === 'rematch') {
        if (player.id !== room.hostId) throw new Error('Only the host can start a rematch.');
        if (room.state !== 'RESULTS') throw new Error('The match is still in progress.');
        room.recent = [...(room.recent || []), ...room.used].slice(-30);
        room.used = [];
        room.round = 0;
        room.reveal = null;
        room.submissions = {};
        room.drafts = {};
        room.players = room.players.filter(item => item.connected);
        room.players.forEach(item => { item.score = 0; item.matches = 0; });
        room.hostId = room.players[0]?.id || null;
        room.state = 'LOBBY';
        return { ok: true };
      }
      throw Object.assign(new Error('Not found.'), { status: 404 });
    });
    return json(res, 200, result);
  } catch (error) {
    return json(res, error.status || 400, { error: error.message || 'Something went wrong.' });
  }
}
