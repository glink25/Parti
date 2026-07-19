import { describe, expect, it } from 'vitest';
import {
  marketBadgesFromLabels,
  marketRefString,
  parseMarketIssueTitle,
  releaseAssetUrl,
} from './marketFormat';

describe('parseMarketIssueTitle', () => {
  it('parses owner/repo without tag', () => {
    expect(parseMarketIssueTitle('[parti-room] alice/game-a')).toEqual({ owner: 'alice', repo: 'game-a' });
  });

  it('parses owner/repo with a release tag', () => {
    expect(parseMarketIssueTitle('[parti-room] alice/game-a@v1.2.0')).toEqual({
      owner: 'alice',
      repo: 'game-a',
      tag: 'v1.2.0',
    });
  });

  it('tolerates extra whitespace and case-insensitive prefix', () => {
    expect(parseMarketIssueTitle('  [Parti-Room]   bob/snake_2  ')).toEqual({ owner: 'bob', repo: 'snake_2' });
  });

  it('rejects titles without the prefix or repo path', () => {
    expect(parseMarketIssueTitle('alice/game-a')).toBeNull();
    expect(parseMarketIssueTitle('[parti-room] alice')).toBeNull();
    expect(parseMarketIssueTitle('[parti-room] alice/game-a extra')).toBeNull();
    expect(parseMarketIssueTitle('[bug] something broken')).toBeNull();
    expect(parseMarketIssueTitle('')).toBeNull();
  });
});

describe('marketBadgesFromLabels', () => {
  it('keeps known badges in canonical order', () => {
    expect(marketBadgesFromLabels(['recommend', 'parti-room', 'beta'])).toEqual(['beta', 'recommend']);
  });

  it('ignores unknown labels', () => {
    expect(marketBadgesFromLabels(['parti-room', 'bug'])).toEqual([]);
    expect(marketBadgesFromLabels([])).toEqual([]);
  });
});

describe('releaseAssetUrl', () => {
  it('uses latest release when no tag is given', () => {
    expect(releaseAssetUrl({ owner: 'alice', repo: 'game-a' }, 'parti.room.zip')).toBe(
      'https://github.com/alice/game-a/releases/latest/download/parti.room.zip',
    );
  });

  it('uses the tagged release when a tag is given', () => {
    expect(releaseAssetUrl({ owner: 'alice', repo: 'game-a', tag: 'v1.0' }, 'parti.room.json')).toBe(
      'https://github.com/alice/game-a/releases/download/v1.0/parti.room.json',
    );
  });
});

describe('marketRefString', () => {
  it('renders owner/repo with optional tag', () => {
    expect(marketRefString({ owner: 'alice', repo: 'game-a' })).toBe('alice/game-a');
    expect(marketRefString({ owner: 'alice', repo: 'game-a', tag: 'v2' })).toBe('alice/game-a@v2');
  });
});
