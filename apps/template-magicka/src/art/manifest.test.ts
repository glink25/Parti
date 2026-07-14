import {describe,expect,it} from 'vitest';
import {ART_MANIFEST,validateArtManifest} from './manifest';
import {PLAYER_ANIMATION_FRAMES,PIXEL_ART,animationFor,facingFromAngle} from './pixelArt';

describe('pixel art contract',()=>{
 it('keeps the player frame and foot anchor stable',()=>{expect(PIXEL_ART.playerFrame).toBe(64);expect(PIXEL_ART.foot).toEqual({x:32,y:52});});
 it('contains the agreed animation frame counts',()=>{expect(PLAYER_ANIMATION_FRAMES.move).toBe(6);expect(PLAYER_ANIMATION_FRAMES.channel).toBe(4);expect(PLAYER_ANIMATION_FRAMES.downed).toBe(4);});
 it('maps angles to eight facings',()=>{expect(facingFromAngle(0)).toBe('e');expect(facingFromAngle(Math.PI/2)).toBe('s');expect(facingFromAngle(Math.PI)).toBe('w');});
 it('prioritizes downed and casting states',()=>{expect(animationFor(undefined,true,false,[])).toBe('downed');expect(animationFor({phase:'channeling',elements:[],spellId:null,castId:null,phaseStartedAt:0,phaseEndsAt:null},false,false,[])).toBe('channel');});
 it('has a valid unique fallback manifest',()=>{expect(validateArtManifest()).toBe(true);expect(Object.keys(ART_MANIFEST)).toHaveLength(8);});
});
