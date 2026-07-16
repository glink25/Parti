import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

function workerBundle(outDir:string):Plugin {
  const entry=resolve('src/worker/index.ts');
  return {name:'bomberman-worker-bundle',buildStart(){this.addWatchFile(entry);for(const file of ['src/game/types.ts','src/game/maps.ts','src/game/rules.ts'])this.addWatchFile(resolve(file));},async closeBundle(){
    const outfile=resolve(outDir,'worker.js');
    await esbuild({entryPoints:[entry],outfile,bundle:true,format:'esm',target:'es2022',external:['@parti/worker-sdk']});
    const source=await readFile(outfile,'utf8');
    await writeFile(outfile,source.replace(/export \{\s*([\w$]+) as default\s*\};?\s*$/m,'export default $1;'));
  }};
}

export default defineConfig(({mode})=>{
  if(mode==='test') return { test: { environment: 'node' } };
  const variable=mode==='room-dev'?'PARTI_ROOM_DEV_OUT_DIR':mode==='room-build'?'PARTI_ROOM_BUILD_OUT_DIR':null;
  if(!variable)throw new Error(`Unsupported mode: ${mode}`);
  const outDir=process.env[variable];if(!outDir)throw new Error(`${variable} is required`);
  return {plugins:[workerBundle(outDir)],build:{outDir,emptyOutDir:true,assetsInlineLimit:0,target:'es2022'}};
});
