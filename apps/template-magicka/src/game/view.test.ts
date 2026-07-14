import {describe,expect,it} from 'vitest';
import {offscreenIndicator,targetCameraScale} from './view';

describe('camera and threat indicators',()=>{
 it('expands exploration vision and expands it again in combat',()=>{const base=Math.min(1280/1050,720/680);expect(targetCameraScale(1280,720,false)).toBeCloseTo(base/1.1);expect(targetCameraScale(1280,720,true)).toBeCloseTo(base/1.21);});
 it('returns a stable padded edge point only for offscreen targets',()=>{const view={x:0,y:0,w:1000,h:600};expect(offscreenIndicator({x:100,y:50},{x:0,y:0},view,30)).toBeNull();expect(offscreenIndicator({x:1000,y:0},{x:0,y:0},view,30)).toEqual({x:970,y:300,angle:0});const corner=offscreenIndicator({x:1000,y:1000},{x:0,y:0},view,30)!;expect(corner.x).toBeCloseTo(770);expect(corner.y).toBeCloseTo(570);});
});
