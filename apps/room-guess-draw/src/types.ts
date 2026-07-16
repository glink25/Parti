export type Mode = 'classic' | 'relay';
export type Phase = 'lobby' | 'choosing' | 'drawing' | 'round-result' | 'game-over' | 'relay-choosing' | 'relay-initial-drawing' | 'relay-guessing' | 'relay-redrawing' | 'relay-final-guess' | 'relay-reveal' | 'relay-gallery';
export type Tool = 'pen' | 'eraser';
export type Point = { x: number; y: number; t?: number };
export type Stroke = { id: string; tool: Tool; color: string; size: number; points: Point[] };
export type Player = { id: string; name: string; connected: boolean; ready: boolean };
export type Message = { id?: string; type: string; playerId?: string; name?: string; text: string };
export type RevealItem = { kind: 'drawing'; playerId: string; strokes: Stroke[] } | { kind: 'guess'; playerId: string; text: string };
export type RevealChain = { id: string; originId: string; word: string; items: RevealItem[] };
export type RelayTask =
  | { kind: 'choose-complete'; word: string; taskId: string }
  | { kind: 'draw'; prompt: string; strokes: Stroke[]; taskId: string }
  | { kind: 'guess' | 'final-guess'; strokes: Stroke[]; step?: number; total?: number; taskId: string };
export type RoomState = {
  schema: string; mode: Mode; hostId: string | null; phase: Phase; players: Record<string, Player>;
  scores: Record<string, number>; turnOrder: string[]; turnIndex: number; roundNumber: number; drawerId: string | null;
  categoryId: string | null; categories: Array<{ id: string; name: string; icon: string; description: string }>;
  pickEndsAt: number | null; roundEndsAt: number | null; revealedHints: string[]; roundGuessers: string[]; guessedIds: string[];
  roundPoints: Record<string, number>; roundResult: { answer?: string; reason?: string } | null; messages: Message[];
  strokes: Stroke[]; activeStroke: Stroke | null; canvasRevision: number; relayParticipants: string[]; relayStep: number; relaySubmittedIds: string[];
  relayDeadline: number | null; relayReveal: null | { chainIndex: number; itemIndex: number; status: string; current: RevealChain; gallery: RevealChain[] | null };
};
