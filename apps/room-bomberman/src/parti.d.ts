import type { GameState } from './game/types';
declare global {
  const parti: {
    playerId: string|null;
    getState(): GameState|undefined;
    onState(handler:(state:GameState)=>void):()=>void;
    onEvent(event:string,handler:(payload:unknown)=>void):()=>void;
    action(name:string,payload?:unknown):Promise<{ok:true}>;
    ready():void;
    leave():void;
    log(...args:unknown[]):void;
  };
}
export {};
