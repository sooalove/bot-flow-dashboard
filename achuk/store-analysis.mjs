/**
 * Store-side analysis claim/commit contract.
 *
 * This is not deployed and the live page does not call it. It does not
 * generate text and it does not open a network connection. A scheduled
 * worker can use these rules only after the same operations exist inside
 * the production Apps Script, wrapped in LockService.getScriptLock().
 *
 * The only Apps Script file in git is an older get/put script. It is not
 * the live version 4 and must not be pasted over production. The live page
 * already uses later event operations. After the current Code.gs is saved
 * from the editor (not the truncated history view), call dispatchAnalysis
 * inside the existing LockService lock and preserveMatch after a whole-match put.
 */

const PMW = {골:3, 어시:2, 유효슈팅:1, 세이브:2, 철벽수비:2};
const ID_KEYS = ['uid', 'user', 'writer', 'device', 'deviceId', 'by', 'voter'];
export const CLAIM_TTL_MS = 120000;

export function isRealPlayer(p){
  return !!(p && !/^용병|^지인|^CTL$|그날FC|\+$/.test(p));
}

export function stripIdentity(v){
  if(Array.isArray(v)) return v.map(stripIdentity);
  if(!v || typeof v !== 'object') return v;
  const o = {};
  Object.keys(v).forEach(k => {
    if(ID_KEYS.includes(k)) return;
    o[k] = stripIdentity(v[k]);
  });
  return o;
}

function ownIdentity(obj){
  return Object.keys(obj || {}).filter(k => ID_KEYS.includes(k));
}

export function matchEnd(m, now){
  const kick = +(m && m.kick) || 0;
  const endAt = m && m.end ? +m.end : (kick ? kick + 2 * 36e5 : 0);
  return {kick, endAt, ended: !!(endAt && now >= endAt)};
}

/** Same gate as the deployed page predicate. A stored AOM name is not an input. */
export function finalizePredicate(m, events, votes, now){
  const roster = [...(m.A && m.A.players || []), ...(m.B && m.B.players || [])].filter(isRealPlayer);
  const end = matchEnd(m, now);
  const deadline = end.endAt ? end.endAt + 30 * 6e4 : 0;
  const vs = (votes || []).filter(v => v && v.p && v.voter).slice().sort((a, b) => (+a.ts || 0) - (+b.ts || 0));
  const last = {};
  let closedAt = 0, why = '';
  for(const v of vs){
    if(deadline && +v.ts > deadline) break;
    if(!roster.includes(v.p)) continue;
    last[v.voter] = v.p;
    if(Object.keys(last).length >= roster.length && roster.length){
      closedAt = +v.ts || now;
      why = '전원 투표';
      break;
    }
  }
  if(!closedAt && deadline && now > deadline){
    closedAt = deadline;
    why = '종료 후 30분';
  }
  const tally = {};
  Object.keys(last).forEach(k => { const p = last[k]; tally[p] = (tally[p] || 0) + 1; });
  const pts = p => (events || []).filter(e => e && e.p === p).reduce((s, e) => s + (PMW[e.k] || 0), 0);
  const counts = Object.keys(tally).map(p => tally[p]);
  const mx = counts.length ? Math.max(...counts) : 0;
  const top = Object.keys(tally).filter(p => tally[p] === mx && mx > 0);
  let win = '', tb = '';
  if(top.length === 1) win = top[0];
  else if(top.length > 1){
    top.sort((a, b) => pts(b) - pts(a) || a.localeCompare(b, 'ko'));
    win = top[0];
    const tiedPts = pts(top[0]) === pts(top[1]);
    tb = '동률 ' + top.length + '명 → 공격·수비 포인트 ' + top.map(p => p + ' ' + pts(p)).join(' / ') + (tiedPts ? ' → 동점이라 이름순' : '');
  }
  const finalized = !!(closedAt && win && tally[win] > 0 && (why === '전원 투표' || why === '종료 후 30분'));
  return {
    ended: end.ended, endAt: end.endAt, deadline, closedAt, why, win, tally, tb,
    voters: Object.keys(last).length, roster: roster.length, ready: !!(end.ended && finalized)
  };
}

export function isReadySnapshot(a){
  return !!(a && a.v === 1 && a.ready === true && a.asOf && a.kind === 'observed' && a.observed && a.observed.score && a.observed.aom && a.observed.aom.win);
}

function canon(v){
  if(Array.isArray(v)) return v.map(canon);
  if(v && typeof v === 'object'){
    const o = {};
    Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); });
    return o;
  }
  return v === undefined ? null : v;
}

/** Inputs that can change the analysis. Lock, snapshot, updatedAt, and the bare AOM name are excluded. */
export function analysisInputs(match){
  const m = match || {};
  const final = m.aomFinal && m.aomFinal.finalized ? {
    win: m.aomFinal.win, why: m.aomFinal.why, tb: m.aomFinal.tb || '',
    closedAt: m.aomFinal.closedAt || 0, endAt: m.aomFinal.endAt || 0,
    deadline: m.aomFinal.deadline || 0, tally: m.aomFinal.tally || {}
  } : null;
  return {
    id: m.id, date: String(m.date || '').slice(0, 10), type: m.type || '',
    kick: +m.kick || 0, end: +m.end || 0,
    A: {name: m.A && m.A.name || '', players: (m.A && m.A.players || []).slice()},
    B: {name: m.B && m.B.name || '', players: (m.B && m.B.players || []).slice()},
    goals: (m.goals || []).map(g => ({eid: g.eid || '', p: g.p || '', k: g.k || '', t: g.t || '', ts: +g.ts || 0})),
    reviews: (m.reviews_anon || []).map(r => ({text: String(r && r.text || '')})),
    aomFinal: final
  };
}

export async function fingerprint(match){
  const body = JSON.stringify(canon(analysisInputs(match)));
  const dig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(dig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fail(error, extra){
  return Object.assign({ok: false, applied: false, error}, extra || {});
}

function matchOf(doc, id){
  return doc && doc.matches && doc.matches[id];
}

export function finalizeAom(doc, req){
  if(ownIdentity(req).length) return fail('identity');
  const m = matchOf(doc, req && req.id);
  if(!m || m.deleted) return fail('match');
  if(m.aomFinal && m.aomFinal.finalized){
    return {ok: true, applied: true, created: false, aomFinal: m.aomFinal};
  }
  const gate = finalizePredicate(m, m.goals || [], req.votes || [], req.now);
  if(!gate.ready) return fail(gate.ended ? 'aom' : 'end', {gate});
  m.aomFinal = {
    v: 1, finalized: true, win: gate.win, why: gate.why, tb: gate.tb,
    tally: gate.tally, closedAt: gate.closedAt, endAt: gate.endAt,
    deadline: gate.deadline, voters: gate.voters, roster: gate.roster, asOf: req.now
  };
  return {ok: true, applied: true, created: true, aomFinal: m.aomFinal};
}

function eligible(m, now){
  const end = matchEnd(m, now);
  const fin = m.aomFinal;
  if(!end.ended) return 'end';
  if(!fin || !fin.finalized || !fin.win || !(fin.tally && fin.tally[fin.win] > 0)) return 'aom';
  if(fin.why !== '전원 투표' && fin.why !== '종료 후 30분') return 'aom';
  return '';
}

export async function claimAnalysis(doc, req){
  if(ownIdentity(req).length) return fail('identity');
  const m = matchOf(doc, req && req.id);
  if(!m || m.deleted) return fail('match');
  if(!(req.now > 0)) return fail('now');
  if(isReadySnapshot(m.analysis)){
    return {ok: true, applied: true, claimed: false, created: false, reason: 'ready', analysis: m.analysis};
  }
  const why = eligible(m, req.now);
  if(why) return fail(why);
  const lock = m.analysisLock;
  if(lock && lock.until > req.now){
    if(req.claimId && lock.id === req.claimId){
      return {ok: true, applied: true, claimed: true, created: false, claimId: lock.id, fingerprint: lock.fingerprint, until: lock.until};
    }
    return {ok: true, applied: true, claimed: false, reason: 'held', until: lock.until};
  }
  if(!req.claimId) return fail('claim');
  const fp = await fingerprint(m);
  const ttl = req.ttlMs > 0 ? req.ttlMs : CLAIM_TTL_MS;
  m.analysisLock = {id: req.claimId, fingerprint: fp, until: req.now + ttl};
  return {ok: true, applied: true, claimed: true, created: true, claimId: req.claimId, fingerprint: fp, until: m.analysisLock.until};
}

export async function commitAnalysis(doc, req){
  if(ownIdentity(req).length) return fail('identity');
  const m = matchOf(doc, req && req.id);
  if(!m || m.deleted) return fail('match');
  if(isReadySnapshot(m.analysis)){
    return {ok: true, applied: true, created: false, analysis: m.analysis};
  }
  const lock = m.analysisLock;
  if(!lock || lock.id !== req.claimId) return fail('claim');
  if(!(req.now > 0) || !(lock.until > req.now)){
    delete m.analysisLock;
    return fail('expired');
  }
  const fp = await fingerprint(m);
  if(fp !== lock.fingerprint){
    delete m.analysisLock;
    return fail('stale');
  }
  const snap = req.snapshot;
  if(!snap || snap.ready === true || snap.kind !== 'observed' || !(snap.asOf > 0)) return fail('snapshot');
  if(!snap.observed || !snap.observed.score || !snap.observed.aom || snap.observed.aom.win !== m.aomFinal.win) return fail('snapshot');
  const stored = stripIdentity(snap);
  stored.v = 1;
  stored.kind = 'observed';
  stored.ready = true;
  m.analysis = stored;
  delete m.analysisLock;
  return {ok: true, applied: true, created: true, analysis: stored};
}

/** Whole-match write. Never creates or replaces a ready snapshot, a final AOM record, or a live claim. */
export function applyGenericPut(doc, record, now){
  if(!record || !record.id || String(record.id).length > 60) return fail('match');
  const cur = matchOf(doc, record.id) || null;
  const next = stripIdentity(record);
  delete next.analysis;
  delete next.analysisLock;
  delete next.aomFinal;
  if(cur && isReadySnapshot(cur.analysis)) next.analysis = cur.analysis;
  if(cur && cur.aomFinal && cur.aomFinal.finalized) next.aomFinal = cur.aomFinal;
  if(cur && cur.analysisLock && cur.analysisLock.until > now) next.analysisLock = cur.analysisLock;
  if(!doc.matches) doc.matches = {};
  doc.matches[record.id] = next;
  return {ok: true, applied: true, preserved: !!(next.analysis && next.analysis.ready)};
}

function pct(n, d){
  if(!d) return null;
  return Math.round((n / d) * 1000) / 10;
}
function pctLabel(n, d){
  const v = pct(n, d);
  if(v == null) return '—';
  return (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1)) + '%';
}
function sideOf(e){
  if(!e) return '';
  if(e.k === '골') return e.t === 'A' ? 'A' : 'B';
  if(e.k === '자책골') return e.t === 'A' ? 'B' : 'A';
  if(e.k === '상대골') return 'B';
  return '';
}

/** Card-shaped snapshot. ready stays false until the store commit. AI text is attached by the caller. */
export function buildObserved(match, now){
  const m = match || {};
  const fin = m.aomFinal;
  if(!fin || !fin.finalized || !fin.win) return null;
  const ev = m.goals || [];
  const score = {A:0, B:0};
  const flow = [];
  ev.forEach(e => {
    const side = sideOf(e);
    if(!side) return;
    score[side]++;
    flow.push({n: flow.length + 1, k: e.k, p: e.p || '', t: e.t || '', side});
  });
  const team = side => {
    const roster = ((m[side] && m[side].players) || []).filter(isRealPlayer);
    const rows = roster.map(p => ({p, goal:0, ast:0, own:0, sot:0, save:0, block:0}));
    const by = {};
    rows.forEach(r => { by[r.p] = r; });
    let direct = 0, assists = 0, ownFor = 0, ownAgainst = 0, opp = 0, sot = 0, save = 0, block = 0;
    ev.forEach(e => {
      if(e.k === '골' && e.t === side){ direct++; if(by[e.p]) by[e.p].goal++; }
      else if(e.k === '어시' && e.t === side){ assists++; if(by[e.p]) by[e.p].ast++; }
      else if(e.k === '자책골' && e.t === side){ ownAgainst++; if(by[e.p]) by[e.p].own++; }
      else if(e.k === '자책골' && (e.t === 'A' || e.t === 'B') && e.t !== side) ownFor++;
      else if(e.k === '상대골' && side === 'B') opp++;
      else if(e.k === '유효슈팅' && e.t === side){ sot++; if(by[e.p]) by[e.p].sot++; }
      else if(e.k === '세이브' && e.t === side){ save++; if(by[e.p]) by[e.p].save++; }
      else if(e.k === '철벽수비' && e.t === side){ block++; if(by[e.p]) by[e.p].block++; }
    });
    const topGoal = rows.reduce((n, r) => Math.max(n, r.goal), 0);
    const top = rows.filter(r => r.goal && r.goal === topGoal);
    return {
      side, name: (m[side] && m[side].name) || side, roster: roster.length, score: score[side],
      direct, assists, ownFor, ownAgainst, opp, sot, save, block, scorers: rows.filter(r => r.goal > 0).length,
      top: top.map(r => ({p: r.p, goal: r.goal, share: pct(r.goal, direct), shareLabel: pctLabel(r.goal, direct)})),
      players: rows
    };
  };
  const A = team('A'), B = team('B');
  const run = [];
  let a = 0, b = 0;
  flow.forEach(f => { if(f.side === 'A') a++; else b++; run.push({n: f.n, a, b}); });
  const facts = [
    A.name + ' ' + A.score + ':' + B.score + ' ' + B.name + ' (직접 득점 ' + A.direct + '+상대 자책 ' + A.ownFor + ' / ' + B.direct + '+' + B.ownFor + ')',
    '득점한 선수 ' + A.scorers + '/' + A.roster + ' · ' + B.scorers + '/' + B.roster,
    '어시스트 ' + A.assists + ' 대 ' + B.assists
  ];
  if(A.top.length) facts.push(A.name + ' 최다 득점 ' + A.top.map(t => t.p + ' ' + t.goal + '골').join(', ') + ' · 직접 득점 ' + A.direct + '골 중 ' + A.top[0].shareLabel);
  if(B.top.length) facts.push(B.name + ' 최다 득점 ' + B.top.map(t => t.p + ' ' + t.goal + '골').join(', ') + ' · 직접 득점 ' + B.direct + '골 중 ' + B.top[0].shareLabel);
  return stripIdentity({
    v: 1, ready: false, kind: 'observed', asOf: now, matchId: m.id,
    date: String(m.date || '').slice(0, 10), ai: null, recommendations: [],
    observed: {
      score: {A: A.score, B: B.score, aName: A.name, bName: B.name},
      aom: {win: fin.win, why: fin.why, tally: fin.tally, tb: fin.tb || '', closedAt: fin.closedAt},
      teams: [A, B], flow, run, facts,
      opinion: (m.reviews_anon || []).map(r => ({text: String(r && r.text || '').trim()})).filter(r => r.text)
    }
  });
}

function publicVotes(votes){
  return (votes || []).filter(v => v && v.voter && v.p).map(v => ({voter: v.voter, p: v.p, ts: +v.ts || 0}));
}

/**
 * Next action for the scheduled routine. It never calls a model.
 * When step is needAi, the routine supplies aiText on the following call and then commits once.
 */
export function planRoutine(input){
  const match = input && input.match;
  const now = input && input.now;
  if(!match || !match.id) return {step: 'wait', reason: 'match'};
  if(isReadySnapshot(match.analysis)) return {step: 'ready', analysis: match.analysis};
  if(!(match.aomFinal && match.aomFinal.finalized)){
    const gate = finalizePredicate(match, match.goals || [], input.votes || [], now);
    if(!gate.ready) return {step: 'wait', reason: gate.ended ? 'aom' : 'end', gate};
    return {step: 'finalizeAom', request: {op: 'finalizeAom', id: match.id, votes: publicVotes(input.votes), now}};
  }
  const lock = match.analysisLock;
  if(lock && lock.until > now && lock.id !== input.claimId) return {step: 'held', until: lock.until};
  if(!lock || !(lock.until > now)){
    return {step: 'claimAnalysis', request: {op: 'claimAnalysis', id: match.id, now, claimId: input.claimId, ttlMs: input.ttlMs || CLAIM_TTL_MS}};
  }
  if(!input.aiText) return {step: 'needAi', claimId: lock.id, fingerprint: lock.fingerprint, until: lock.until};
  const snapshot = buildObserved(match, now);
  if(!snapshot) return {step: 'wait', reason: 'aom'};
  snapshot.ai = {text: String(input.aiText)};
  return {step: 'commitAnalysis', request: {op: 'commitAnalysis', id: match.id, claimId: input.claimId, now, snapshot}};
}

/** Call inside the existing script lock. Does not handle get, put, or event ops. */
export async function dispatchAnalysis(doc, body){
  if(!body || ownIdentity(body).length) return fail('identity');
  if(body.op === 'finalizeAom') return finalizeAom(doc, body);
  if(body.op === 'claimAnalysis') return claimAnalysis(doc, body);
  if(body.op === 'commitAnalysis') return commitAnalysis(doc, body);
  return fail('op');
}
