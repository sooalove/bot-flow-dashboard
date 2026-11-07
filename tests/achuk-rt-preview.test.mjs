// Preview board only. Does not touch the production scoreboard or a live match.
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
assert.ok(rec && fx);
const api = new Function(rec[1] + '\n' + fx[1] + '\nreturn {scoreFromEvents,createRecorder,fxAdmit,fxTone,scoreSide,recLabel};')();

const match = () => ({id:'preview-board', type:'internal', A:{name:'블랙', players:['김','이']}, B:{name:'블루', players:['최','정']}, goals:[]});
function mem(start){
  let goals = start.slice();
  return async (body) => {
    if (globalThis.__fail) return {ok:false};
    if (body.op === 'addEvent') {
      goals = goals.concat([{p:body.p, k:body.k, t:body.t, eid:body.eventId, ts:1}]);
      return {ok:true, applied:true, match:Object.assign(match(), {goals})};
    }
    return {ok:false, applied:false};
  };
}

{
  const recdr = api.createRecorder();
  let cur = match();
  const goal = await recdr.add(cur, {eid:'1', p:'김', k:'골', t:'A'}, 'preview', mem([]), 1000);
  assert.equal(goal.ok, true);
  assert.deepEqual(api.scoreFromEvents(goal.match.goals, goal.match), [1,0]);
  cur = goal.match;
  const own = await recdr.add(cur, {eid:'2', p:'김', k:'자책골', t:'A'}, 'preview', mem(cur.goals), 2000);
  assert.deepEqual(api.scoreFromEvents(own.match.goals, own.match), [1,1]);
  const ast = await recdr.add(own.match, {eid:'3', p:'이', k:'어시', t:'A'}, 'preview', mem(own.match.goals), 3000);
  assert.deepEqual(api.scoreFromEvents(ast.match.goals, ast.match), [1,1]);
  const save = await recdr.add(ast.match, {eid:'4', p:'최', k:'세이브', t:'B'}, 'preview', mem(ast.match.goals), 4000);
  assert.deepEqual(api.scoreFromEvents(save.match.goals, save.match), [1,1]);
  globalThis.__fail = true;
  const failed = await recdr.add(save.match, {eid:'5', p:'최', k:'골', t:'B'}, 'preview', mem(save.match.goals), 5000);
  assert.equal(failed.ok, false);
  assert.equal(failed.match, save.match);
  globalThis.__fail = false;
  let calls = 0;
  const once = async () => { calls++; return {ok:true, applied:true, match:save.match}; };
  const dupR = api.createRecorder();
  const a = dupR.add(save.match, {eid:'6', p:'최', k:'골', t:'B'}, 'preview', once, 6000);
  const b = await dupR.add(save.match, {eid:'7', p:'최', k:'골', t:'B'}, 'preview', once, 6000);
  assert.equal(b.reason, 'busy');
  assert.equal(calls, 1);
  await a;
}

{
  const start = 5000;
  let seen = {};
  const old = api.fxAdmit({eid:'seed-a', k:'골', t:'A', ts:1000}, seen, false, start);
  assert.equal(old.play, false);
  seen = old.seen;
  assert.equal(api.fxAdmit({eid:'seed-a', k:'골', ts:9000}, seen, false, start).play, false);
  const goal = api.fxAdmit({eid:'n1', k:'골', t:'B', ts:9000}, seen, true, start);
  assert.equal(goal.play, true);
  assert.equal(goal.tone, 'goal');
  assert.equal(api.fxAdmit({eid:'n1', k:'골', ts:9001}, goal.seen, true, start).play, false);
  assert.equal(api.fxTone('어시'), 'soft');
  assert.equal(api.fxTone('세이브'), 'soft');
  assert.equal(api.scoreSide({k:'자책골', t:'A'}), 'B');
}

assert.match(preview, /미리보기/);
assert.match(preview, /실제 경기에는 저장되지 않아요/);
assert.doesNotMatch(preview, /firebase|initializeApp|signInAnonymously/);
assert.equal(preview.includes('fetch(STORE'), false);
assert.match(preview, /prefers-reduced-motion:reduce/);
assert.match(preview, /#ffc65a/);
assert.match(preview, /aria-label="기록 등록"/);
assert.match(preview, /aria-label="좌우 바꾸기"/);
assert.match(preview, /\.board\.sw \.A\{order:3\}/);
const version = JSON.parse(readFileSync(new URL('../achuk-rt/board/version.json', import.meta.url), 'utf8'));
assert.equal(version.b, '20261107093000');
assert.match(preview, /const B='20261107093000'/);
assert.equal(JSON.parse(liveVer).b, '20261107084500');

console.log('preview board tests ok');
