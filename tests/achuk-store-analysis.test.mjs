// In-memory contract only. No network and no live match write.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  finalizePredicate, finalizeAom, claimAnalysis, commitAnalysis,
  applyGenericPut, fingerprint, analysisInputs
} from '../achuk/store-analysis.mjs';

const html = readFileSync(new URL('../achuk/index.html', import.meta.url), 'utf8');
const src = html.match(/\/\/ ANALYSIS-BEGIN\n([\s\S]*?)\nfunction pmSideName/);
assert.ok(src, 'page predicate');
const page = new Function(src[1] + '\nreturn {pmFinalize};')();

const kick = Date.parse('2026-11-07T06:00:00Z');
const end = kick + 2 * 3600 * 1000;
const after = end + 31 * 60 * 1000;
const black = ['가', '나'];
const blue = ['다', '라'];

function base(extra){
  return Object.assign({
    id: 'm-1793794557925', date: '2026-11-07', type: 'internal', kick,
    aom: '주홍', A: {name: '블랙', players: black.slice()}, B: {name: '블루', players: blue.slice()},
    sa: 1, sb: 0, goals: [{eid: 'g1', p: '가', k: '골', t: 'A', ts: kick + 1000}],
    reviews_anon: [{text: '재미있었다', uid: 'drop-me'}]
  }, extra || {});
}
function doc(m){ return {matches: {[m.id]: m}}; }
function votes(){
  return black.concat(blue).map((p, i) => ({voter: 'ballot-' + i, p: '가', ts: kick + 1000 + i}));
}
const snap = (win = '가') => ({
  v: 1, ready: false, kind: 'observed', asOf: after, ai: {text: '저장된 해석', uid: 'nope'},
  recommendations: [],
  observed: {score: {A: 1, B: 0, aName: '블랙', bName: '블루'}, aom: {win, why: '전원 투표'}, facts: ['하나'], opinion: [{text: '의견'}]}
});

{
  const cases = [
    [base(), [], after],
    [base(), votes(), kick + 60000],
    [base(), votes(), after],
    [base({kick: 0, end: 0}), votes(), after],
    [base(), [{voter: '1', p: '가', ts: kick + 1}, {voter: '2', p: '다', ts: kick + 2}], after]
  ];
  for(const [m, v, now] of cases){
    assert.deepEqual(finalizePredicate(m, m.goals, v, now), page.pmFinalize(m, m.goals, v, now));
  }
  const named = base();
  assert.equal(finalizePredicate(named, named.goals, [], after).ready, false);
  assert.equal(finalizePredicate(named, named.goals, [], after).win, '');
}

{
  const m = base();
  const d = doc(m);
  const goals = m.goals;
  const noVotes = finalizeAom(d, {id: m.id, votes: [], now: after});
  assert.equal(noVotes.error, 'aom');
  assert.equal(m.aomFinal, undefined);
  assert.equal(m.aom, '주홍');
  const tooSoon = finalizeAom(d, {id: m.id, votes: votes(), now: kick + 60000});
  assert.equal(tooSoon.error, 'end');
  const ok = finalizeAom(d, {id: m.id, votes: votes(), now: after});
  assert.equal(ok.created, true);
  assert.equal(ok.aomFinal.win, '가');
  assert.equal(ok.aomFinal.why, '전원 투표');
  assert.equal(m.aom, '주홍');
  assert.equal(m.goals, goals);
  assert.equal(m.analysis, undefined);
  const again = finalizeAom(d, {id: m.id, votes: [{voter: 'z', p: '다', ts: kick + 5}], now: after + 1});
  assert.equal(again.created, false);
  assert.equal(again.aomFinal.win, '가');
  assert.equal(finalizeAom(d, {id: m.id, votes: votes(), now: after, uid: 'x'}).error, 'identity');
}

{
  const m = base();
  const d = doc(m);
  finalizeAom(d, {id: m.id, votes: votes(), now: after});
  const before = await fingerprint(m);
  m.updatedAt = 999;
  m.aom = '다른이름';
  m.analysis = {ready: true, v: 1};
  m.analysisLock = {id: 'old'};
  assert.equal(await fingerprint(m), before);
  delete m.analysis;
  delete m.analysisLock;
  const fp1 = await fingerprint(m);
  const c1 = await claimAnalysis(d, {id: m.id, now: after, claimId: 'c-1', ttlMs: 1000});
  assert.equal(c1.claimed, true);
  assert.equal(c1.fingerprint, fp1);
  const held = await claimAnalysis(d, {id: m.id, now: after + 10, claimId: 'c-2'});
  assert.equal(held.claimed, false);
  assert.equal(held.reason, 'held');
  assert.equal(m.analysisLock.id, 'c-1');
  const retry = await claimAnalysis(d, {id: m.id, now: after + 10, claimId: 'c-1'});
  assert.equal(retry.claimed, true);
  assert.equal(retry.created, false);
  const goals = m.goals.slice();
  const committed = await commitAnalysis(d, {id: m.id, claimId: 'c-1', now: after + 20, snapshot: snap()});
  assert.equal(committed.created, true);
  assert.equal(committed.analysis.ready, true);
  assert.equal(committed.analysis.ai.uid, undefined);
  assert.equal(committed.analysis.ai.text, '저장된 해석');
  assert.deepEqual(m.goals, goals);
  assert.equal(m.analysisLock, undefined);
  const other = snap();
  other.observed.facts = ['바꾼 문장'];
  other.asOf = 1;
  const second = await commitAnalysis(d, {id: m.id, claimId: 'other', now: after + 30, snapshot: other});
  assert.equal(second.created, false);
  assert.equal(second.analysis, m.analysis);
  assert.deepEqual(m.analysis.observed.facts, ['하나']);
}

{
  const m = base();
  const d = doc(m);
  finalizeAom(d, {id: m.id, votes: votes(), now: after});
  await claimAnalysis(d, {id: m.id, now: after, claimId: 'c-stale', ttlMs: 5000});
  m.goals = m.goals.concat([{eid: 'g2', p: '다', k: '골', t: 'B', ts: kick + 2000}]);
  const stale = await commitAnalysis(d, {id: m.id, claimId: 'c-stale', now: after + 10, snapshot: snap()});
  assert.equal(stale.error, 'stale');
  assert.equal(m.analysis, undefined);
  assert.equal(m.goals.length, 2);
  assert.equal(m.analysisLock, undefined);
  const again = await claimAnalysis(d, {id: m.id, now: after + 20, claimId: 'c-new', ttlMs: 5000});
  assert.equal(again.claimed, true);
  assert.notEqual(again.fingerprint, undefined);
}

{
  const m = base();
  const d = doc(m);
  finalizeAom(d, {id: m.id, votes: votes(), now: after});
  await claimAnalysis(d, {id: m.id, now: after, claimId: 'c-old', ttlMs: 1000});
  const expired = await commitAnalysis(d, {id: m.id, claimId: 'c-old', now: after + 1000, snapshot: snap()});
  assert.equal(expired.error, 'expired');
  assert.equal(m.analysis, undefined);
  const re = await claimAnalysis(d, {id: m.id, now: after + 1001, claimId: 'c-re', ttlMs: 1000});
  assert.equal(re.claimed, true);
  assert.equal((await commitAnalysis(d, {id: m.id, claimId: 'c-re', now: after + 1100, snapshot: Object.assign(snap(), {ready: true})})).error, 'snapshot');
  assert.equal((await commitAnalysis(d, {id: m.id, claimId: 'c-re', now: after + 1100, snapshot: Object.assign(snap('주홍'), {ready: false})})).error, 'snapshot');
}

{
  const m = base();
  const d = doc(m);
  finalizeAom(d, {id: m.id, votes: votes(), now: after});
  await claimAnalysis(d, {id: m.id, now: after, claimId: 'c-put', ttlMs: 5000});
  await commitAnalysis(d, {id: m.id, claimId: 'c-put', now: after + 10, snapshot: snap()});
  const saved = m.analysis;
  const fin = m.aomFinal;
  const put = applyGenericPut(d, {
    id: m.id, updatedAt: 999999, aom: '주홍', kick, date: m.date, type: 'internal',
    A: m.A, B: m.B, sa: 2, sb: 1,
    goals: m.goals.concat([{eid: 'g9', p: '나', k: '골', t: 'A'}]),
    analysis: {v: 1, ready: true, kind: 'observed', asOf: 1, observed: {score: {}, aom: {win: '가짜'}}},
    aomFinal: {finalized: true, win: '가짜', why: '종료 후 30분', tally: {가짜: 1}},
    analysisLock: {id: 'forged', until: after + 999999}
  }, after + 50);
  assert.equal(put.preserved, true);
  assert.equal(d.matches[m.id].analysis, saved);
  assert.equal(d.matches[m.id].aomFinal, fin);
  assert.equal(d.matches[m.id].goals.length, 2);
  assert.equal(d.matches[m.id].analysisLock, undefined);
  assert.equal((await commitAnalysis(d, {id: m.id, claimId: 'late', now: after + 60, snapshot: snap()})).analysis, saved);
}

{
  const bare = base();
  delete bare.goals;
  bare.goals = [];
  const d = doc(bare);
  assert.equal((await claimAnalysis(d, {id: bare.id, now: after, claimId: 'x'})).error, 'aom');
  assert.equal(bare.analysis, undefined);
  assert.equal(bare.analysisLock, undefined);
  const forged = applyGenericPut(d, Object.assign({}, bare, {
    analysis: {v: 1, ready: true, kind: 'observed', asOf: after, observed: {score: {A: 1, B: 0}, aom: {win: '주홍'}}}
  }), after);
  assert.equal(forged.preserved, false);
  assert.equal(d.matches[bare.id].analysis, undefined);
}

{
  const inputs = analysisInputs(base());
  assert.equal(inputs.aom, undefined);
  assert.equal(JSON.stringify(inputs).includes('주홍'), false);
  assert.equal(JSON.stringify(inputs).includes('drop-me'), false);
}

console.log('store analysis contract tests ok');
