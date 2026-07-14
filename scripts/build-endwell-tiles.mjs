import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url), sharp = require('sharp');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'apps/room-endwell/public/assets/endwell/atlas/endwell-world.webp');
const outputPath = path.join(root, 'apps/room-endwell/public/assets/endwell/atlas/endwell-ruins-tiles.webp');
const TILE = 128, GUTTER = 2, SPAN = TILE + GUTTER * 2, COLS = 8, ROWS = 3;

async function sourceCell(index) {
  return sharp(sourcePath).extract({ left: index % 4 * 256 + 32, top: Math.floor(index / 4) * 256 + 32, width: 192, height: 192 }).resize(TILE, TILE).removeAlpha().raw().toBuffer();
}
async function seamless(index) {
  const svg = Buffer.from(`<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg"><defs><filter id="stone" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="17" stitchTiles="stitch"/><feColorMatrix values=".10 0 0 0 .04 0 .11 0 0 .045 0 0 .14 0 .07 0 0 0 .32 0"/><feBlend in="SourceGraphic" mode="screen"/></filter><pattern id="slabs" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M0 .5H32M.5 0V32" stroke="#070912" stroke-opacity=".34"/><path d="M0 2H32M2 0V32" stroke="#323747" stroke-opacity=".12"/></pattern></defs><rect width="128" height="128" fill="#131722" filter="url(#stone)"/><rect width="128" height="128" fill="url(#slabs)"/><path d="M0 64H128M64 0V128" stroke="#080b13" stroke-opacity=".12"/></svg>`);
  const data = Buffer.from(await sharp(svg).removeAlpha().raw().toBuffer()), channels = 3, fade = 12;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < fade; x++) { const right = TILE - 1 - x, amount = (fade - x) / fade; for (let k = 0; k < channels; k++) { const li = (y * TILE + x) * channels + k, ri = (y * TILE + right) * channels + k, average = (data[li] + data[ri]) / 2; data[li] = data[li] * (1 - amount) + average * amount; data[ri] = data[ri] * (1 - amount) + average * amount; } }
  for (let x = 0; x < TILE; x++) for (let y = 0; y < fade; y++) { const bottom = TILE - 1 - y, amount = (fade - y) / fade; for (let k = 0; k < channels; k++) { const ti = (y * TILE + x) * channels + k, bi = (bottom * TILE + x) * channels + k, average = (data[ti] + data[bi]) / 2; data[ti] = data[ti] * (1 - amount) + average * amount; data[bi] = data[bi] * (1 - amount) + average * amount; } }
  return sharp(data, { raw: { width: TILE, height: TILE, channels } }).png().toBuffer();
}
async function variant(base, detailIndex, opacity) {
  const paths = ['M28 34L46 48 39 67 61 82', 'M89 27L72 43 83 61 66 72 76 96', 'M32 91L49 76 45 58 63 43 57 28'];
  const detail = Buffer.from(`<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg"><path d="${paths[(detailIndex - 1) % paths.length]}" fill="none" stroke="#5d4b78" stroke-width="2" opacity="${opacity}"/><path d="${paths[(detailIndex - 1) % paths.length]}" fill="none" stroke="#080a12" stroke-width="5" opacity=".28"/></svg>`);
  return sharp(base).composite([{ input: detail }]).png().toBuffer();
}
function ornament(kind) {
  const common = 'fill="none" stroke="#75615f" stroke-width="5"', gold = '#b69a63', violet = '#6e4d91';
  const pieces = {
    corridorH: `<path d="M0 18H128M0 110H128" ${common} opacity=".45"/>`, corridorV: `<path d="M18 0V128M110 0V128" ${common} opacity=".45"/>`,
    north: `<rect width="128" height="106" fill="#090a10" opacity=".86"/><path d="M0 96H128" stroke="${gold}" stroke-width="7"/><path d="M0 70H128M0 42H128M16 16H112" ${common}/><path d="M24 16V70M64 16V70M104 16V70" stroke="#3f3a43" stroke-width="3"/>` , south: `<rect y="22" width="128" height="106" fill="#090a10" opacity=".86"/><path d="M0 32H128" stroke="${gold}" stroke-width="7"/><path d="M0 58H128M0 86H128M16 112H112" ${common}/><path d="M24 58V112M64 58V112M104 58V112" stroke="#3f3a43" stroke-width="3"/>` ,
    west: `<rect width="106" height="128" fill="#090a10" opacity=".86"/><path d="M96 0V128" stroke="${gold}" stroke-width="7"/><path d="M70 0V128M42 0V128M16 16V112" ${common}/><path d="M16 24H70M16 64H70M16 104H70" stroke="#3f3a43" stroke-width="3"/>` , east: `<rect x="22" width="106" height="128" fill="#090a10" opacity=".86"/><path d="M32 0V128" stroke="${gold}" stroke-width="7"/><path d="M58 0V128M86 0V128M112 16V112" ${common}/><path d="M58 24H112M58 64H112M58 104H112" stroke="#3f3a43" stroke-width="3"/>` ,
    nw: `<path d="M96 128V96H128M96 96L58 58" stroke="${gold}" stroke-width="6"/><path d="M10 10H82V82" ${common}/>` , ne: `<path d="M0 96H32V128M32 96L70 58" stroke="${gold}" stroke-width="6"/><path d="M118 10H46V82" ${common}/>` ,
    se: `<path d="M32 0V32H0M32 32L70 70" stroke="${gold}" stroke-width="6"/><path d="M118 118H46V46" ${common}/>` , sw: `<path d="M96 0V32H128M96 32L58 70" stroke="${gold}" stroke-width="6"/><path d="M10 118H82V46" ${common}/>` ,
    rune: `<circle cx="64" cy="64" r="45" stroke="${violet}" stroke-width="5"/><path d="M64 12L92 64 64 116 36 64ZM20 64H108M64 20V108" stroke="#a878db" stroke-width="3" fill="none"/>`,
    pillar: `<rect x="32" y="12" width="64" height="104" rx="10" fill="#12121b" stroke="${gold}" stroke-width="5"/><path d="M42 28H86M42 100H86" ${common}/>` ,
    edge: `<path d="M8 104H120M26 82H102" ${common}/><circle cx="64" cy="84" r="8" fill="${violet}"/>`, corner: `<path d="M14 14H90V90" ${common}/><path d="M30 30H74V74" stroke="${gold}" stroke-width="4" fill="none"/>`,
    innerNW: `<path d="M0 64H64V0" stroke="${gold}" stroke-width="6" fill="none"/><path d="M18 64H64V18" ${common}/>` , innerNE: `<path d="M128 64H64V0" stroke="${gold}" stroke-width="6" fill="none"/><path d="M110 64H64V18" ${common}/>` ,
    innerSE: `<path d="M128 64H64V128" stroke="${gold}" stroke-width="6" fill="none"/><path d="M110 64H64V110" ${common}/>` , innerSW: `<path d="M0 64H64V128" stroke="${gold}" stroke-width="6" fill="none"/><path d="M18 64H64V110" ${common}/>` ,
    doorH: `<rect x="4" width="30" height="128" rx="8" fill="#090a10" stroke="${gold}" stroke-width="6"/><rect x="94" width="30" height="128" rx="8" fill="#090a10" stroke="${gold}" stroke-width="6"/><path d="M38 64H90" stroke="#61e6ff" stroke-width="5" opacity=".8"/><circle cx="64" cy="64" r="9" fill="#b790ff"/>` , doorV: `<rect y="4" width="128" height="30" rx="8" fill="#090a10" stroke="${gold}" stroke-width="6"/><rect y="94" width="128" height="30" rx="8" fill="#090a10" stroke="${gold}" stroke-width="6"/><path d="M64 38V90" stroke="#61e6ff" stroke-width="5" opacity=".8"/><circle cx="64" cy="64" r="9" fill="#b790ff"/>` ,
  };
  return Buffer.from(`<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">${pieces[kind] ?? ''}</svg>`);
}
async function decorated(base, kind) { return sharp(base).composite([{ input: ornament(kind), left: 0, top: 0 }]).png().toBuffer(); }
async function withGutter(tile) { return sharp(tile).extend({ top: GUTTER, bottom: GUTTER, left: GUTTER, right: GUTTER, extendWith: 'copy' }).png().toBuffer(); }

const base = await seamless(0), bases = [base, await variant(base, 1, .16), await variant(base, 2, .12), await variant(base, 3, .09)];
const specs = [bases[0], bases[1], bases[2], bases[3], await decorated(bases[0], 'corridorH'), await decorated(bases[0], 'corridorV'), await decorated(bases[3], 'north'), await decorated(bases[3], 'south'), await decorated(bases[3], 'west'), await decorated(bases[3], 'east'), await decorated(bases[3], 'nw'), await decorated(bases[3], 'ne'), await decorated(bases[3], 'se'), await decorated(bases[3], 'sw'), await decorated(bases[3], 'innerNW'), await decorated(bases[3], 'innerNE'), await decorated(bases[3], 'innerSE'), await decorated(bases[3], 'innerSW'), await decorated(bases[0], 'doorH'), await decorated(bases[0], 'doorV'), await decorated(bases[3], 'pillar'), await decorated(bases[0], 'edge'), await decorated(bases[0], 'corner'), await decorated(bases[0], 'rune')];
const cells = await Promise.all(specs.map(withGutter));
await sharp({ create: { width: COLS * SPAN, height: ROWS * SPAN, channels: 4, background: '#070711ff' } }).composite(cells.map((input, index) => ({ input, left: index % COLS * SPAN, top: Math.floor(index / COLS) * SPAN }))).webp({ quality: 78, smartSubsample: true }).toFile(outputPath);
console.log(`built ${path.relative(root, outputPath)} (${COLS}x${ROWS}, tile ${TILE}, gutter ${GUTTER})`);
