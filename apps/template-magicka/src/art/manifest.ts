import type {BiomeId,Element,EnemyKind} from '../game/contracts';

export type ArtAssetId=`character/player/base`|`equipment/robe/${string}`|`equipment/staff/${string}`|`enemy/${EnemyKind}`|`spell/${Element}/${string}`|`environment/${BiomeId}/${string}`|`ui/${string}/${string}`;
export type FrameAnchor='foot'|'leftHand'|'rightHand'|'staffGrip'|'staffTip'|'spellOrigin';
export type AtlasFrame={x:number;y:number;width:number;height:number;durationMs:number;anchors:Partial<Record<FrameAnchor,{x:number;y:number}>>;event?:'attack'|'release'};
export type AtlasAnimation={directions:5|8;mirrorDirections:boolean;loop:boolean;frames:AtlasFrame[]};
export type ArtAsset={id:ArtAssetId;image?:string;frameSize:{width:number;height:number};animations?:Record<string,AtlasAnimation>;fallback:'procedural'};

export const ART_MANIFEST:Readonly<Record<string,ArtAsset>>={
 player:{id:'character/player/base',frameSize:{width:64,height:64},fallback:'procedural'},
 chaser:{id:'enemy/chaser',frameSize:{width:64,height:64},fallback:'procedural'},
 shooter:{id:'enemy/shooter',frameSize:{width:64,height:64},fallback:'procedural'},
 waterFiend:{id:'enemy/water-fiend',frameSize:{width:64,height:64},fallback:'procedural'},
 shieldGuard:{id:'enemy/shield-guard',frameSize:{width:64,height:64},fallback:'procedural'},
 reflectWarden:{id:'enemy/reflect-warden',frameSize:{width:96,height:96},fallback:'procedural'},
 resonancePriest:{id:'enemy/resonance-priest',frameSize:{width:96,height:96},fallback:'procedural'},
 ruinGuardian:{id:'enemy/ruin-guardian',frameSize:{width:128,height:128},fallback:'procedural'}
};

export function validateArtManifest(entries=Object.values(ART_MANIFEST)){const ids=new Set<string>();for(const asset of entries){if(ids.has(asset.id))throw new Error(`Duplicate art id: ${asset.id}`);ids.add(asset.id);if(asset.frameSize.width<=0||asset.frameSize.height<=0)throw new Error(`Invalid frame size: ${asset.id}`);}return true;}
