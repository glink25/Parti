export const INVITE_QR_SIZE = 320;
export const INVITE_QR_QUIET_ZONE = 4;
export const MIN_QR_MODULE_PIXELS = 4;

export interface InviteQrRenderProfile {
  errorCorrectionLevel: 'H' | 'M';
  showLogo: boolean;
}

/**
 * Long invite URLs produce dense matrices. At small module sizes the center
 * logo costs more scan reliability than high error correction can recover.
 */
export function selectInviteQrRenderProfile(moduleCount: number): InviteQrRenderProfile {
  const pixelsPerModule = INVITE_QR_SIZE / (moduleCount + INVITE_QR_QUIET_ZONE * 2);
  if (pixelsPerModule < MIN_QR_MODULE_PIXELS) {
    return { errorCorrectionLevel: 'M', showLogo: false };
  }
  return { errorCorrectionLevel: 'H', showLogo: true };
}
