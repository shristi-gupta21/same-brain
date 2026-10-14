import type { Player, Room, Screen } from '../types/game';

export function screenForRoom(room: Room): Screen {
  if (room.state === 'QUESTION' || room.state === 'COUNTDOWN') return 'game';
  if (room.state === 'REVEAL') return 'reveal';
  if (room.state === 'RESULTS') return 'results';
  return 'lobby';
}

export function playerInitials(name: string): string {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export function remainingSeconds(room: Room | null, now: number, offset: number): number {
  const endsAt = room?.question?.endsAt;
  return endsAt ? Math.max(0, Math.ceil((endsAt - (now + offset)) / 1000)) : 0;
}

export function countdownSeconds(room: Room | null, now: number, offset: number): number {
  const startsAt = room?.question?.startsAt;
  return startsAt ? Math.max(1, Math.ceil((startsAt - (now + offset)) / 1000)) : 1;
}

export function formatTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function rankPlayers(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.score - a.score);
}

export function matchPercent(room: Room | null): number {
  if (!room?.players.length) return 0;
  return Math.min(100, room.submittedCount / room.players.length * 100);
}
