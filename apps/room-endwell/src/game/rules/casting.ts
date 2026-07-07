import type { CastState, SpellCasterState, SpellSpec, Vec2 } from '../contracts';

export function beginCast(caster: SpellCasterState, castId: string, spell: SpellSpec, aim: Vec2, target: Vec2, now: number) {
  if ('aim' in caster) caster.aim = aim;
  caster.cast = { phase: 'chanting', castId, spell, startedAt: now, phaseEndsAt: now + spell.chantMs, aim, target };
}

export function beginRecovery(caster: SpellCasterState, now: number, recoveryMs?: number) {
  const spell = caster.cast.spell;
  caster.cast.phase = 'recovery';
  caster.cast.phaseEndsAt = now + (recoveryMs ?? spell?.recoveryMs ?? 0);
}

export function resetCast(caster: SpellCasterState) {
  caster.cast = idleCast(caster.aim ?? caster.cast.aim);
}

export function idleCast(aim: Vec2 = { x: 1, y: 0 }): CastState {
  return { phase: 'idle', castId: null, spell: null, startedAt: 0, phaseEndsAt: null, aim, target: { x: 0, y: 0 } };
}
