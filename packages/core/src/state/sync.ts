/**
 * 状态同步引擎 —— MVP 只实现 Snapshot 模式 (GOAL.md §13.1, §20.6)。
 *
 * Host 侧：持有权威 state 的版本与哈希，每次变更生成完整 snapshot。
 * Client 侧：应用 snapshot 并缓存最新 state。
 *
 * Patch / event-sourcing 留到后续阶段，接口此处先不暴露。
 */
import type { SnapshotPayload } from '../protocol/messages.js';
import { stateHash } from './hash.js';

export class StateSyncEngine {
  private version = 0;
  private hash = '';
  private snapshotCache: unknown = undefined;

  /**
   * 记录一次新的权威状态，返回可广播的 snapshot payload。
   * 仅当哈希变化时才递增版本，避免无意义广播。
   */
  commit(state: unknown): SnapshotPayload {
    const nextHash = stateHash(state);
    if (nextHash !== this.hash) {
      this.version += 1;
      this.hash = nextHash;
      // 结构化克隆，确保广播出去的快照与后续可变 state 解耦
      this.snapshotCache = structuredClone(state);
    }
    return this.currentSnapshot();
  }

  /**
   * 从持久化快照恢复（房主刷新后水合）。把版本/哈希/缓存预置到该快照，
   * 之后 commit 会在此基础上继续递增，保证客户端不会因版本回退而忽略更新。
   */
  restore(snapshot: SnapshotPayload): void {
    this.version = snapshot.version;
    this.hash = snapshot.stateHash;
    this.snapshotCache =
      snapshot.state === undefined ? undefined : structuredClone(snapshot.state);
  }

  /** 当前版本的 snapshot（用于新玩家加入时下发）。 */
  currentSnapshot(): SnapshotPayload {
    return {
      version: this.version,
      state: this.snapshotCache,
      stateHash: this.hash,
    };
  }

  getVersion(): number {
    return this.version;
  }

  getHash(): string {
    return this.hash;
  }
}

/** Client 侧的轻量 snapshot 应用器。 */
export class ClientStateCache {
  private version = -1;
  private state: unknown = null;

  /** 应用一个 snapshot；若版本不更新则忽略。返回是否实际更新。 */
  applySnapshot(snapshot: SnapshotPayload): boolean {
    if (snapshot.version < this.version) return false;
    this.version = snapshot.version;
    this.state = snapshot.state;
    return true;
  }

  getState<T = unknown>(): T | null {
    return this.state as T | null;
  }

  getVersion(): number {
    return this.version;
  }
}
