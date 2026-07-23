import { describe, expect, it } from 'vitest';
import { livingSpeakingOrder, resolveVote, tallyVotes, voteLeaders } from './round-flow';

describe('livingSpeakingOrder', () => {
  it('keeps dealt order and drops eliminated players', () => {
    expect(livingSpeakingOrder(['a', 'b', 'c', 'd'], ['b'])).toEqual(['a', 'c', 'd']);
  });

  it('rotates the start point over living players', () => {
    expect(livingSpeakingOrder(['a', 'b', 'c', 'd'], [], 1)).toEqual(['b', 'c', 'd', 'a']);
    expect(livingSpeakingOrder(['a', 'b', 'c', 'd'], ['a'], 1)).toEqual(['c', 'd', 'b']);
  });

  it('wraps the start index and handles empty living set', () => {
    expect(livingSpeakingOrder(['a', 'b', 'c'], [], 5)).toEqual(['c', 'a', 'b']);
    expect(livingSpeakingOrder(['a'], ['a'])).toEqual([]);
  });
});

describe('vote tally', () => {
  it('counts targets and ignores empty targets', () => {
    expect(tallyVotes({ a: 'x', b: 'x', c: 'y', d: '' })).toEqual({ x: 2, y: 1 });
  });

  it('returns all tied leaders', () => {
    expect(voteLeaders({ x: 2, y: 2, z: 1 }).sort()).toEqual(['x', 'y']);
    expect(voteLeaders({})).toEqual([]);
  });
});

describe('resolveVote', () => {
  it('eliminates the sole top target', () => {
    expect(resolveVote({ a: 'x', b: 'x', c: 'y' }, ['x', 'y'])).toEqual({ leaders: ['x'], eliminatedId: 'x', tie: false });
  });

  it('flags a tie without eliminating', () => {
    const outcome = resolveVote({ a: 'x', b: 'y' }, ['x', 'y']);
    expect(outcome.eliminatedId).toBeNull();
    expect(outcome.tie).toBe(true);
    expect(outcome.leaders.sort()).toEqual(['x', 'y']);
  });

  it('ignores votes for non-candidates', () => {
    expect(resolveVote({ a: 'ghost', b: 'x' }, ['x', 'y'])).toEqual({ leaders: ['x'], eliminatedId: 'x', tie: false });
  });

  it('treats an empty vote as no elimination', () => {
    expect(resolveVote({}, ['x', 'y'])).toEqual({ leaders: [], eliminatedId: null, tie: false });
  });
});
