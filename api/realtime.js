import { Emitter } from '@socket.io/redis-emitter';
import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL?.replace(/^redis:\/\//, 'rediss://');
let emitterPromise;

async function getEmitter() {
  if (!redisUrl) return null;
  if (!emitterPromise) {
    const publisher = createClient({ url: redisUrl });
    publisher.on('error', () => {});
    emitterPromise = publisher.connect()
      .then(() => new Emitter(publisher))
      .catch(error => {
        emitterPromise = null;
        throw error;
      });
  }
  return emitterPromise;
}

export async function publishRoomChanged(roomCode) {
  try {
    const emitter = await getEmitter();
    emitter?.to(`room:${roomCode}`).emit('room:changed');
  } catch {
    // The state API remains authoritative and clients keep polling as fallback.
  }
}

export function roomRevision(room) {
  return JSON.stringify({
    state: room.state,
    round: room.round,
    question: room.question?.id,
    startsAt: room.startsAt,
    endsAt: room.endsAt,
    hostId: room.hostId,
    players: room.players.map(({ id, connected, score, matches }) => [id, connected, score, matches]),
    submissionCount: Object.keys(room.submissions).length,
    reveal: room.reveal
  });
}
