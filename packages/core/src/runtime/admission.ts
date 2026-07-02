import type { PeerId } from '../transport/types';

export type AdmissionPhase = 'package' | 'join';

export interface AdmissionRequest {
  roomId: string;
  phase: AdmissionPhase;
  peerId: PeerId;
  clientId?: string;
  credential?: string;
}

export type AdmissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: 'CREDENTIAL_REQUIRED' | 'INVALID_CREDENTIAL';
      message: string;
    };

/** Runtime 不理解 credential 的含义；具体密码/票据策略由宿主层实现。 */
export interface RoomAdmissionController {
  authorize(request: AdmissionRequest): AdmissionDecision;
}

export interface RoomAdmissionStatus {
  /** 当前 connected / ready 的玩家数，包含房主。 */
  activePlayers: number;
  /** 包含宽限期离线玩家的占位数，用于容量判断。 */
  reservedPlayers: number;
  maxPlayers: number | null;
  joinable: boolean;
}
