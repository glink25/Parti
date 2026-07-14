export function alignToDevicePixel(value: number, pixelRatio: number) { return Math.round(value * pixelRatio) / pixelRatio; }
