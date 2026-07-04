import { describe,expect,it } from 'vitest';
import type { PlayerActivity,PlayerRealtimeFrame } from './contracts';
import { MAX_EXTRAPOLATION_MS,REALTIME_HEARTBEAT_MS,REALTIME_INTERVAL_MS,interpolateRealtime,shouldPublishRealtime } from './realtime';
const activity:PlayerActivity={phase:'idle',elements:[],spellId:null,castId:null,phaseStartedAt:0,phaseEndsAt:null};
const frame=(sequence:number,sentAt:number,x:number):PlayerRealtimeFrame=>({sequence,sentAt,x,y:0,z:0,activity});
describe('realtime player synchronization',()=>{
 it('uses a 24ms foreground interval and a 250ms unchanged heartbeat',()=>{expect(REALTIME_INTERVAL_MS).toBe(24);expect(REALTIME_HEARTBEAT_MS).toBe(250);expect(shouldPublishRealtime(24,24,250,true)).toBe(true);expect(shouldPublishRealtime(24,24,250,false)).toBe(false);expect(shouldPublishRealtime(250,24,250,false)).toBe(true);});
 it('interpolates for 50ms and caps extrapolation at 100ms',()=>{const a=frame(1,0,0),b=frame(2,24,24);expect(interpolateRealtime(a,b,100,125).x).toBe(12);expect(interpolateRealtime(a,b,100,250).x).toBe(24+MAX_EXTRAPOLATION_MS);expect(interpolateRealtime(a,b,100,500).x).toBe(24+MAX_EXTRAPOLATION_MS);});
});
