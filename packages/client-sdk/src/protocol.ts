/**
 * iframe(Room UI) ↔ 宿主页(host-bridge) 的 postMessage 协议 (GOAL.md §10.3)。
 * Room UI 不直接触网，只通过这层与 Runtime 通信。
 */

/** iframe -> 宿主页 */
export type UiToHost =
  | { __parti: true; type: 'hello' }
  | { __parti: true; type: 'action'; action: string; payload: unknown }
  | { __parti: true; type: 'ready' }
  | { __parti: true; type: 'leave' }
  | { __parti: true; type: 'orientation-request'; requestId: number }
  | { __parti: true; type: 'log'; args: unknown[] }
  /**
   * 房间 UI 通过 parti.exposeToAgent 注册的"转述"结果。仅在 agent 模式下发出，
   * 供无头浏览器 agent 从宿主页读取当前游戏状况的文字/结构化说明（无障碍式）。
   */
  | { __parti: true; type: 'agent-guide'; guide: unknown };

/** 宿主页 -> iframe */
export type HostToUi =
  | { __parti: true; type: 'init'; playerId: string; state: unknown; agent?: boolean }
  | { __parti: true; type: 'state'; state: unknown }
  | { __parti: true; type: 'event'; event: string; payload: unknown }
  | { __parti: true; type: 'orientation-status'; status: OrientationStatus; requestId?: number }
  | { __parti: true; type: 'orientation-data'; data: OrientationData }
  | { __parti: true; type: 'error'; code: string; message: string };

export type OrientationStatus =
  | 'unsupported'
  | 'needs-permission'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'blocked-by-policy'
  | 'no-data';

export interface OrientationData {
  beta: number;
  gamma: number;
  screenAngle: number;
  timestamp: number;
}
