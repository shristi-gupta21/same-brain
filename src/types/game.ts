export type Screen = 'home' | 'create' | 'join' | 'quick' | 'lobby' | 'game' | 'reveal' | 'results';

export type Player = {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  score: number;
  matches: number;
};

export type RevealedPlayer = Pick<Player, 'id' | 'name' | 'color'>;

export type RevealGroup = {
  answer: string;
  players: RevealedPlayer[];
  points: number;
};

export type RoomQuestion = {
  text: string;
  category: string;
  startsAt: number;
  endsAt: number;
};

export type Room = {
  roomCode: string;
  mode: 'public' | 'private';
  hostId: string;
  playerId: string;
  config: { questions: number; seconds: number };
  players: Player[];
  state: string;
  round: number;
  question: RoomQuestion | null;
  submittedCount: number;
  ownSubmitted: boolean;
  reveal?: RevealGroup[];
  winners?: string[];
  serverNow: number;
};

export type SetupValues = {
  name: string;
  code?: string;
};
