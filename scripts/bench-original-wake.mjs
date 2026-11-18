// Reproduce the missed-wake race against the exact current checkout and HEAD.
// Local only: no camera, production API, database or storage requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSingleFlight, flushOriginalPhotos } from '../src/kiosk/network-tasks.js';

if (process.argv.includes('--help')) {
  console.log('node scripts/bench-original-wake.mjs [--baseline=<commit>]\nLocal queue scheduling comparison; takes about 30 seconds. No network or production data.');
  process.exit(0);
}
const root=fileURLToPath(new URL('..',import.meta.url));
const revision=process.argv.find(arg=>arg.startsWith('--baseline='))?.slice(11)||'HEAD';
const baseline=execFileSync('git',['rev-parse',revision],{cwd:root,encoding:'utf8'}).trim();
const source=execFileSync('git',['show',`${baseline}:src/kiosk/network-tasks.js`],{cwd:root,encoding:'utf8'});
const old=await import('data:text/javascript;base64,'+Buffer.from(source.replace(/from (["'])(\.{1,2}\/[^"']+)\1/g,(_,q,path)=>`from ${JSON.stringify(new URL(path,new URL('../src/kiosk/network-tasks.js',import.meta.url)).href)}`)).toString('base64'));
const POLL_MS=30000;
const bytes=new TextEncoder().encode('Synthetic original; benchmark measures scheduling, not network throughput.');
const checksum=createHash('sha256').update(bytes).digest('hex');
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
async function run(factory,trailing){
  const gate=factory({trailing}),read=deferred(),release=deferred(),complete=deferred();
  let rows=[],first=true,sent=0;
  const start=performance.now();
  const action=()=>flushOriginalPhotos({
    isActive:()=>true,concurrency:3,
    readPending:async()=>{const snapshot=[...rows];if(first){read.resolve();await release.promise}return snapshot},
    upload:async row=>{
      assert.equal(createHash('sha256').update(Buffer.from(await row.image.arrayBuffer())).digest('hex'),checksum);
      await new Promise(done=>setTimeout(done,25));sent++;
    },
    removePending:async id=>{rows=rows.filter(row=>row.id!==id);complete.resolve()},savePending:async()=>{},
  });
  const firstRun=gate.run(action);
  await read.promise;
  rows.push({id:'durable-photo',token:'fixture',stage:'original',originalAt:Date.now(),image:new Blob([bytes])});
  gate.run(action);first=false;release.resolve();
  const poll=setTimeout(()=>gate.run(action).catch(complete.resolve),POLL_MS);
  let timeout;
  try { await Promise.race([complete.promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Queue did not acknowledge the row')),45000)})]);await firstRun; }
  finally { clearTimeout(poll);clearTimeout(timeout); }
  assert.equal(sent,1);assert.equal(rows.length,0);
  return {elapsedMs:performance.now()-start,sent};
}
console.log('Reproducing a durable original arriving during the final outbox read (30 s polling interval).');
const results={old:await run(old.createSingleFlight,false),new:await run(createSingleFlight,true)};
const report={date:new Date().toISOString(),baseline,method:'Actual queue functions; controlled final-read race, 25 ms simulated acknowledgement, real 30 s timer. Not an upload-speed benchmark.',pollMs:POLL_MS,checksum,results,savedMs:results.old.elapsedMs-results.new.elapsedMs};
await mkdir(resolve(root,'.cache'),{recursive:true});
await writeFile(resolve(root,'.cache/bench-original-wake.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
