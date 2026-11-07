// Isolated preview. Production board must stay byte-identical to main.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const preview = readFileSync(new URL('../achuk-rt/board/index.html', import.meta.url), 'utf8');
const live = readFileSync(new URL('../achuk/board/index.html', import.meta.url), 'utf8');
const liveMain = execFileSync('git', ['show', 'origin/main:achuk/board/index.html'], {encoding:'utf8'});
const liveVer = execFileSync('git', ['show', 'origin/main:achuk/board/version.json'], {encoding:'utf8'});
assert.equal(live, liveMain);
assert.equal(readFileSync(new URL('../achuk/board/version.json', import.meta.url), 'utf8'), liveVer);

const rec = preview.match(/\/\/ RECORD-LOGIC-BEGIN\n([\s\S]*?)\n\/\/ RECORD-LOGIC-END/);
const fx = preview.match(/\/\/ FX-BEGIN\n([\s\S]*?)\n\/\/ FX-END/);
const api = new Function(rec[1] + '\n' + fx[1] + '\nreturn {scoreFromEvents,createRecorder,fxAdmit,fxTone,scoreSide};')();
const match = () => ({id:'preview-board', type:'internal', A:{name:'블랙', players:['김','이']}, B:{name:'블루', players:['최','정']}, goals:[]});

{
  const recdr = api.createRecorder();
  const goal = await recdr.add(match(), {eid:'1', p:'김', k:'골', t:'A'}, 'preview', async () => ({ok:true, applied:true, match:match()}), 1000);
  assert.deepEqual(api.scoreFromEvents(goal.match.goals, goal.match), [1,0]);
  const own = await recdr.add(goal.match, {eid:'2', p:'김', k:'자책골', t:'A'}, 'preview', async () => ({ok:true, applied:true, match:goal.match}), 2000);
  assert.deepEqual(api.scoreFromEvents(own.match.goals, own.match), [1,1]);
  const ast = await recdr.add(own.match, {eid:'3', p:'이', k:'어시', t:'A'}, 'preview', async () => ({ok:true, applied:true, match:own.match}), 3000);
  assert.deepEqual(api.scoreFromEvents(ast.match.goals, ast.match), [1,1]);
  globalThis.__skip = true;
  const failed = await recdr.add(ast.match, {eid:'4', p:'최', k:'세이브', t:'B'}, 'preview', async () => ({ok:false}), 4000);
  assert.equal(failed.ok, false);
  assert.equal(failed.match, ast.match);
  let calls = 0;
  const gate = api.createRecorder();
  const a = gate.add(ast.match, {eid:'5', p:'최', k:'골', t:'B'}, 'preview', async () => { calls++; return {ok:true, applied:true, match:ast.match}; }, 6000);
  const b = await gate.add(ast.match, {eid:'6', p:'최', k:'골', t:'B'}, 'preview', async () => { calls++; return {ok:true, applied:true, match:ast.match}; }, 6000);
  assert.equal(b.reason, 'busy');
  assert.equal(calls, 1);
  await a;
}

{
  const start = 5000;
  const old = api.fxAdmit({eid:'seed-a', k:'골', ts:1000}, {}, false, start);
  assert.equal(old.play, false);
  assert.equal(api.fxAdmit({eid:'seed-a', k:'골', ts:9000}, old.seen, true, start).play, false);
  const goal = api.fxAdmit({eid:'n', k:'골', ts:9000}, old.seen, true, start);
  assert.equal(goal.play, true);
  assert.equal(goal.tone, 'goal');
  assert.equal(api.fxTone('세이브'), 'soft');
  assert.equal(api.scoreSide({k:'자책골', t:'A'}), 'B');
}

assert.match(preview, /미리보기 · 실제 경기에는 저장되지 않아요/);
assert.doesNotMatch(preview, /firebase|initializeApp|box-shadow|JUST DO IT|swoosh/i);
assert.equal(preview.includes('fetch(STORE'), false);
assert.match(preview, /#f5f5f5/);
assert.match(preview, /#111/);
assert.match(preview, /border-radius:999px/);
assert.match(preview, /prefers-reduced-motion:reduce/);
assert.match(preview, /\.board\.sw \.A\{order:3/);
assert.match(preview, /const B='20261107103000'/);
assert.equal(JSON.parse(readFileSync(new URL('../achuk-rt/board/version.json', import.meta.url), 'utf8')).b, '20261107103000');
assert.equal(JSON.parse(liveVer).b, '20261107084500');
console.log('preview board tests ok');
