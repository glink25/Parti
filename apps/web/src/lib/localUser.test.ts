import { describe, expect, it } from 'vitest';
import { loadLocalUser, saveLocalUserName, UserNameValidationError } from './localUser.js';

class TestStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('本地用户身份', () => {
  it('首次生成后保持同一 ID，改名不会改变 ID', () => {
    const storage = new TestStorage();
    const first = loadLocalUser(storage);
    const second = loadLocalUser(storage);
    const renamed = saveLocalUserName('  周末牌友  ', storage);

    expect(first.id).toMatch(/^user_/);
    expect(first.name).toMatch(/^\S+ \d{4}$/);
    expect(second).toEqual(first);
    expect(renamed).toEqual({ id: first.id, name: '周末牌友' });
    expect(loadLocalUser(storage)).toEqual(renamed);
  });

  it('存储损坏时生成并保存一份新身份', () => {
    const storage = new TestStorage();
    storage.setItem('parti:user', '{broken');

    const user = loadLocalUser(storage);

    expect(user.id).toMatch(/^user_/);
    expect(JSON.parse(storage.getItem('parti:user')!)).toEqual(user);
  });

  it('拒绝空用户名和过长用户名', () => {
    const storage = new TestStorage();
    loadLocalUser(storage);
    expect(() => saveLocalUserName('   ', storage)).toThrow(UserNameValidationError);
    expect(() => saveLocalUserName('   ', storage)).toThrow(expect.objectContaining({ code: 'empty' }));
    expect(() => saveLocalUserName('名'.repeat(25), storage)).toThrow(expect.objectContaining({ code: 'tooLong' }));
  });
});
