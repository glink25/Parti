/** @parti/client-sdk —— Room UI 注入脚本 + 宿主页沙箱桥 */
export { CLIENT_SDK_SCRIPT } from './bootstrap.js';
export {
  UISandboxBridge,
  buildRoomDocument,
  createHostLocalPort,
  createClientPort,
} from './host-bridge.js';
export type { RoomClientPort, UISandboxBridgeOptions } from './host-bridge.js';
export type { UiToHost, HostToUi } from './protocol.js';
