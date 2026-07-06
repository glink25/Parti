import type { Vec2 } from '../game/contracts';

export type Rect = { x: number; y: number; w: number; h: number };
export type HudLayout = { compact: boolean; status: Rect; message: Rect; elementPanel: Rect; elementCenters: Array<Vec2 & { r: number }> };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const contains = (rect: Rect, point: Vec2) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
export function computeHudLayout(width: number, height: number): HudLayout { const compact = width < 900 || height < 560, pad = compact ? 8 : 12, diameter = clamp((width - 32) / 7 - (compact ? 3 : 7), 46, 66), gap = clamp((width - diameter * 7 - 24) / 6, 3, 14), panelW = diameter * 7 + gap * 6 + 20, panelH = compact ? 84 : 98, panelX = (width - panelW) / 2, panelY = height - panelH - (compact ? 6 : 10), centerY = panelY + panelH - diameter / 2 - 7; return { compact, status: { x: pad, y: pad, w: compact ? 174 : 205, h: compact ? 60 : 70 }, message: { x: Math.max(pad, (width - Math.min(440, width * .48)) / 2), y: pad, w: Math.min(440, width * .48), h: compact ? 34 : 40 }, elementPanel: { x: panelX, y: panelY, w: panelW, h: panelH }, elementCenters: Array.from({ length: 7 }, (_, index) => ({ x: panelX + 10 + diameter / 2 + index * (diameter + gap), y: centerY, r: diameter / 2 })) }; }
export function hudBlocksWorld(layout: HudLayout, point: Vec2) { return contains(layout.status, point) || contains(layout.message, point) || contains(layout.elementPanel, point); }
