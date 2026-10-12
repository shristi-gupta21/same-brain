import http from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { createClient } from 'redis';

const server = http.createServer();
const redisUrl = process.env.REDIS_URL?.replace(/^redis:\/\//, 'rediss://');
const restUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const restToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const io = new Server(server, {
  path: '/api/socket-io/socket.io',
  transports: ['websocket'],
  serveClient: true,
  connectTimeout: 5000,
  maxHttpBufferSize: 1024
});

async function redisRest(...args) {
  if (!restUrl || !restToken) throw new Error('Room storage is not configured.');
  const response = await fetch(restUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${restToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(args)
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error('Room storage is unavailable.');
  return body.result;
}

let adapterPromise;
async function ensureAdapter() {
  if (!redisUrl) return false;
  if (!adapterPromise) adapterPromise = (async () => {
    const publisher = createClient({ url: redisUrl });
    const subscriber = publisher.duplicate();
    publisher.on('error', () => {});
    subscriber.on('error', () => {});
    await Promise.all([publisher.connect(), subscriber.connect()]);
    io.adapter(createAdapter(publisher, subscriber));
    return true;
  })().catch(() => {
    adapterPromise = null;
    return false;
  });
  return adapterPromise;
}

io.use(async (socket, next) => {
  try {
    if (!await ensureAdapter()) return next(new Error('Realtime is not configured.'));
    const session = String(socket.handshake.auth?.session || '');
    if (!session) return next(new Error('A room session is required.'));
    const storedSession = await redisRest('GET', `session:${session}`);
    if (!storedSession) return next(new Error('This room session has ended.'));
    const location = JSON.parse(storedSession);
    if (!(await redisRest('EXISTS', `room:${location.room}`))) {
      return next(new Error('This room session has ended.'));
    }
    socket.data.roomCode = location.room;
    next();
  } catch {
    next(new Error('Realtime connection unavailable.'));
  }
});

io.on('connection', socket => {
  socket.join(`room:${socket.data.roomCode}`);
  socket.emit('room:changed');
});

export default server;
