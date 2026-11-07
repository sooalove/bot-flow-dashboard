// Mock/sandbox only. Does not read config, call the store, or touch real matches.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../achuk/board/index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ RECORD-LOGIC-BEGIN\n([\s\S]*?)\n\/\/ RECORD-LOGIC-END/);
assert.ok(block, 'record logic block');
const api = new Function(block[1] + '\nreturn {REC_KINDS,recLabel,scoreFromEvents,persistedEvents,applyPersistedEvent,addEventRequest,removeEventRequest,livePayload,entryAllowed,createRecorder,saveRecord,deleteRecord};')();

const match = () => ({
  id:'m-test', date:'2026-11-07', type:'internal', base:false,
  A:{name:'블랙', players:['김','이']}, B:{name:'블루', players:['박','최']},
  sa:0, sb:0, goals:[]
});
const ev = (p,k,t,eid='e-'+k+'-'+p+'-'+t) => ({eid, p, k, t, ts:1, uid:'should-not-stick', device:'tablet'});
const okFetch = (extra) => async (body) => ({ok:true, applied:true, match:Object.assign(match(), extra||{}, {goals:[]}), body});

function shown(m, live, removed){
  return api.scoreFromEvents(api.persistedEvents(m, live||{}, removed||{}), m);
}

const cases = [
  ['골 A', ev('김','골','A'), [1,0]],
  ['골 B', ev('박','골','B'), [0,1]],
  ['자책골 A → 블루', ev('김','자책골','A'), [0,1]],
  ['자책골 B → 블랙', ev('박','자책골','B'), [1,0]],
  ['어시', ev('이','어시','A'), [0,0]],
  ['세이브(슈퍼세이브)', ev('최','세이브','B'), [0,0]],
  ['유효슈팅', ev('김','유효슈팅','A'), [0,0]],
  ['철벽수비', ev('박','철벽수비','B'), [0,0]]
];
for(const [name, event, want] of cases){
  const saved = api.applyPersistedEvent(match(), event);
  assert.deepEqual(shown(saved), want, name);
  assert.equal(saved.goals[0].uid, undefined, name+' uid');
  assert.equal(saved.goals[0].device, undefined, name+' device');
}

{
  const ext = match(); ext.type='external'; ext.B.name='상대FC';
  const saved = api.applyPersistedEvent(ext, {eid:'og', p:'상대FC', k:'상대골', t:'B', ts:1});
  assert.deepEqual(shown(saved), [0,1], '상대골');
  const rec = api.createRecorder();
  let calls=0;
  const res = await rec.add(ext, {eid:'og2', p:'상대FC', k:'상대골', t:'B', ts:2}, 'test-key', async ()=>{calls++; return {ok:true, applied:true, match:ext};}, 10);
  assert.equal(res.ok, true);
  assert.equal(calls, 1);
  assert.deepEqual(shown(res.match), [0,1]);
}

{
  const base = match(); base.base=true; base.sa=3; base.sb=1;
  const saved = api.applyPersistedEvent(base, ev('김','골','A','base1'));
  assert.deepEqual(shown(saved), [3,1], 'base score stays stored');
  assert.equal(saved.goals.length, 1);
}

{
  const server = match(); server.sa=99; server.sb=7;
  server.goals=[{eid:'g1', p:'김', k:'골', t:'A', eventId:'g1'}];
  const saved = api.applyPersistedEvent(server, ev('김','골','A','g1'));
  assert.equal(saved.goals.length, 1, 'same event id is not duplicated');
  assert.deepEqual(shown(saved), [1,0], 'score comes from events, not a separate counter');
}

{
  const dup = match();
  dup.goals=[{eid:'g1', k:'골', t:'A', p:'김'}, {eid:'g1', k:'골', t:'A', p:'김'}];
  assert.deepEqual(api.scoreFromEvents(dup.goals, dup), [1,0], 'duplicate eid counts once');
}

{
  const m = match();
  const live = {pend:{eid:'pend', k:'골', t:'A', p:'김', saved:false}, echo:{eid:'g1', k:'골', t:'A', p:'김'}};
  m.goals=[{eid:'g1', k:'골', t:'A', p:'김'}];
  assert.deepEqual(shown(m, live), [1,0], 'pending and echo do not add a second goal');
}

{
  const rec = api.createRecorder();
  const m0 = match();
  const goalsBefore = m0.goals;
  let calls=0;
  const fail = await rec.add(m0, ev('김','골','A','f1'), 'test-key', async ()=>{calls++; throw new Error('offline');}, 100);
  assert.equal(fail.ok, false);
  assert.equal(fail.reason, 'fail');
  assert.equal(calls, 1);
  assert.strictEqual(fail.match, m0);
  assert.strictEqual(m0.goals, goalsBefore);
  assert.deepEqual(shown(m0), [0,0]);
  const rejected = await rec.add(m0, ev('김','골','A','f2'), 'test-key', async ()=>{calls++; return {ok:false, error:'kind'};}, 200);
  assert.equal(rejected.reason, 'fail');
  assert.equal(calls, 2);
  assert.deepEqual(shown(m0), [0,0]);
  const again = await rec.add(m0, ev('김','골','A','ok1'), 'test-key', async ()=>({ok:true, applied:true, match:{id:m0.id, goals:[], sa:5, sb:5, A:m0.A, B:m0.B}}), 300);
  assert.equal(again.ok, true);
  assert.deepEqual(shown(again.match), [1,0]);
}

{
  const rec = api.createRecorder();
  const m0 = match();
  let calls=0;
  let release;
  const pending = rec.add(m0, ev('김','골','A','slow'), 'test-key', ()=>{calls++; return new Promise(r=>{release=()=>r({ok:true, applied:true, match:m0});});}, 1000);
  const second = await rec.add(m0, ev('김','골','A','slow2'), 'test-key', ()=>{calls++; return {ok:true, applied:true, match:m0};}, 1000);
  assert.equal(second.reason, 'busy');
  assert.equal(calls, 1);
  release();
  const first = await pending;
  assert.equal(first.ok, true);
  assert.deepEqual(shown(first.match), [1,0]);
  const dup = await rec.add(first.match, ev('김','골','A','dup'), 'test-key', ()=>{calls++; return {ok:true, applied:true, match:first.match};}, 1400);
  assert.equal(dup.reason, 'dup');
  assert.equal(calls, 1);
  assert.deepEqual(shown(first.match), [1,0]);
}

{
  const rec = api.createRecorder();
  let calls=0;
  let cur = match();
  const fetchImpl = async (body)=>{
    calls++;
    const goals=cur.goals.concat([{p:body.p,k:body.k,t:body.t,eid:body.eventId,ts:1}]);
    return {ok:true, applied:true, match:Object.assign({}, cur, {goals, sa:99, sb:99})};
  };
  const steps = [
    ev('김','골','A','s1'),
    ev('이','어시','A','s2'),
    ev('최','세이브','B','s3'),
    ev('박','자책골','B','s4'),
    ev('김','골','A','s5')
  ];
  const want = [[1,0],[1,0],[1,0],[2,0],[3,0]];
  for(let i=0;i<steps.length;i++){
    const res = await rec.add(cur, steps[i], 'test-key', fetchImpl, 5000+i*1000);
    assert.equal(res.ok, true, 'step '+i);
    cur = res.match;
    assert.deepEqual(shown(cur), want[i], 'step '+i);
    assert.deepEqual(Object.keys(res.request).sort(), ['eventId','id','k','key','op','p','t']);
    assert.equal(res.request.uid, undefined);
    assert.equal(res.request.key, 'test-key');
    assert.equal(api.livePayload(steps[i]).uid, undefined);
    assert.deepEqual(Object.keys(api.livePayload(steps[i])).sort(), ['k','p','t']);
  }
  assert.equal(calls, steps.length);
}

{
  let cur = api.applyPersistedEvent(match(), ev('김','골','A','del1'));
  assert.deepEqual(shown(cur), [1,0]);
  const kept = await api.deleteRecord(cur, 'del1', 'test-key', async ()=>{throw new Error('no');});
  assert.equal(kept.ok, false);
  assert.deepEqual(shown(kept.match), [1,0]);
  const gone = await api.deleteRecord(cur, 'del1', 'test-key', async ()=>({ok:true, applied:true, match:cur}));
  assert.equal(gone.ok, true);
  assert.deepEqual(shown(gone.match), [0,0]);
  assert.deepEqual(Object.keys(gone.request).sort(), ['eventId','id','key','op']);
  assert.equal(gone.request.uid, undefined);
}

{
  const rec = api.createRecorder();
  let calls=0;
  const no = await rec.add(match(), {eid:'x', p:'없는사람', k:'골', t:'A'}, 'test-key', async ()=>{calls++; return {ok:true, applied:true};}, 1);
  assert.equal(no.reason, 'reject');
  assert.equal(calls, 0);
  const pv = match(); pv.id='pv-sandbox-1';
  const noPv = await rec.add(pv, ev('김','골','A','pv'), 'test-key', async ()=>{calls++; return {ok:true, applied:true};}, 2);
  assert.equal(noPv.reason, 'reject');
  const internalOpp = await rec.add(match(), {eid:'opp', p:'상대', k:'상대골', t:'B'}, 'test-key', async ()=>{calls++; return {ok:true, applied:true};}, 3);
  assert.equal(internalOpp.reason, 'reject');
  assert.equal(calls, 0);
}

assert.equal(api.recLabel('세이브'), '슈퍼세이브');
assert.equal(api.recLabel('골'), '골');
assert.ok(api.REC_KINDS.includes('세이브') && !api.REC_KINDS.includes('슈퍼세이브'));

assert.match(html, /#recb\{position:fixed;right:/);
assert.match(html, /bottom:max\(1\.5vh,env\(safe-area-inset-bottom\)\)/);
assert.match(html, /\.board\.sw \.A\{order:3\}\.board\.sw \.B\{order:1\}/);
assert.match(html, /class="team A"><p class="id"><i aria-hidden="true"><\/i>블랙<\/p><h2>\$\{esc\(M\.A&&M\.A\.name\|\|'A'\)\}<\/h2><div class="sc" id="sa">/);
assert.match(html, /class="team B"><p class="id"><i aria-hidden="true"><\/i>블루<\/p><h2>\$\{esc\(M\.B&&M\.B\.name\|\|'B'\)\}<\/h2><div class="sc" id="sb">/);
assert.match(html, /class="board\$\{SW\?' sw':''\}"/);
assert.match(html, /aria-label="기록 등록">기록</);
assert.match(html, /aria-label="좌우 바꾸기"/);
assert.doesNotMatch(html, /sa\s*\+\+|sb\s*\+\+|M\.sa\s*=\s*\(?M\.sa/);
const commit = html.indexOf('async function commitRec');
const failReturn = html.indexOf('if(!res.ok)', commit);
const assign = html.indexOf('M=res.match', commit);
const publish = html.indexOf('publishLive(ev)', commit);
assert.ok(commit>0 && failReturn>commit && assign>failReturn && publish>assign, 'score publish follows a successful save');
assert.equal(html.includes('uid:'), false);
assert.match(html, /const B='20261107084500'/);
const version = JSON.parse(readFileSync(new URL('../achuk/board/version.json', import.meta.url), 'utf8'));
assert.equal(version.b, '20261107084500');

console.log('achuk board record tests ok');
