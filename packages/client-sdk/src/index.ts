/** @parti/client-sdk —— Room UI 注入脚本 + 宿主页沙箱桥 */
export { CLIENT_SDK_SCRIPT } from './bootstrap';
export {
  UISandboxBridge,
  buildRoomDocument,
  createHostLocalPort,
  createClientPort,
} from './host-bridge';
export type { RoomClientPort, UISandboxBridgeOptions } from './host-bridge';
export type { UiToHost, HostToUi, OrientationData, OrientationStatus } from './protocol';
