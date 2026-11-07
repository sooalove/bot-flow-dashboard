// Mock only. Does not read config, call the store, or write a real match.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../achuk/index.html', import.meta.url), 'utf8');
const tesla = readFileSync(new URL('../achuk/tesla/index.html', import.meta.url), 'utf8');
assert.equal(tesla, html);
const block = html.match(/\/\/ ANALYSIS-BEGIN\n([\s\S]*?)\n\/\/ ANALYSIS-END/);
assert.ok(block, 'analysis block');
const api = new Function(block[1] + '\nreturn {pmFinalize,pmBuild,pmReady,pmSaveRequest,pmApplyWrite,analysisCard,pmPctLabel};')();

const kick = Date.parse('2026-11-07T01:00:00Z');
const end = kick + 2 * 3600 * 1000;
const after = end + 31 * 60 * 1000;
const black = ['가','나','다','라','마','바','사'];
const blue = ['A','B','C','D','E','F','G','H'];
const goals = {가:4,나:2,다:2,라:2,마:2,바:2,사:1,A:3,B:1,C:1};
function ev(p,k,t){return {p,k,t,eid:p+k+t+Math.random()}}
function exampleEvents(){
  const out=[];
  Object.entries(goals).forEach(([p,n])=>{
    const t = black.includes(p)?'A':'B';
    for(let i=0;i<n;i++) out.push({p,k:'골',t,eid:'g-'+p+'-'+i});
  });
  out.push({p:'A',k:'자책골',t:'B',eid:'og-blue'});
  for(let i=0;i<7;i++) out.push({p:black[i%7],k:'어시',t:'A',eid:'aa'+i});
  for(let i=0;i<2;i++) out.push({p:blue[i],k:'어시',t:'B',eid:'bb'+i});
  return out;
}
function match(extra){
  return Object.assign({id:'m-test',date:'2026-11-07',type:'internal',kick,aom:'주홍',A:{name:'블랙',players:black.slice()},B:{name:'블루',players:blue.slice()},sa:0,sb:0,goals:[]}, extra||{});
}
function votesFor(name, n=1){
  return Array.from({length:n}, (_,i)=>({voter:'v'+name+i,p:name,ts:kick+60000+i}));
}

{
  const events=exampleEvents();
  const votes=votesFor('가', 2).concat(votesFor('A', 1));
  const built=api.pmBuild(match(), events, votes, [{text:'가 선수는 최고였다', uid:'nope'}], after);
  assert.equal(built.ok, true);
  const o=built.snapshot.observed;
  assert.equal(built.snapshot.ready, false);
  assert.equal(built.snapshot.ai, null);
  assert.deepEqual(built.snapshot.recommendations, []);
  assert.equal(o.score.A, 16);
  assert.equal(o.score.B, 5);
  assert.equal(o.teams[0].direct, 15);
  assert.equal(o.teams[0].ownFor, 1);
  assert.equal(o.teams[0].scorers, 7);
  assert.equal(o.teams[0].roster, 7);
  assert.equal(o.teams[1].scorers, 3);
  assert.equal(o.teams[1].roster, 8);
  assert.equal(o.teams[0].assists, 7);
  assert.equal(o.teams[1].assists, 2);
  assert.equal(o.teams[0].top[0].p, '가');
  assert.equal(o.teams[0].top[0].shareLabel, '26.7%');
  assert.equal(o.teams[1].top[0].p, 'A');
  assert.equal(o.teams[1].top[0].shareLabel, '60%');
  assert.equal(o.aom.win, '가');
  assert.notEqual(o.aom.win, '주홍');
  assert.equal(JSON.stringify(built.snapshot).includes('uid'), false);
  assert.equal(o.flow.length, 21);
  assert.equal(o.flow.some(f=>f.k==='어시'), false);
  assert.equal(o.facts.join(' ').includes('최고였다'), false);
  assert.equal(o.opinion[0].text, '가 선수는 최고였다');
  assert.equal(o.opinion[0].uid, undefined);
  const card=api.analysisCard({analysis:Object.assign({}, built.snapshot, {ready:true})});
  assert.match(card, /블랙 16 : 5 블루/);
  assert.match(card, /AOM 가/);
  assert.match(card, /26\.7%/);
  assert.match(card, /60%/);
  assert.match(card, /득점 순서/);
  assert.match(card, /주관적 의견/);
  assert.match(card, /저장된 AI 해석이 없어요/);
  assert.doesNotMatch(card, /xG|점유율|슈팅 정확|per90|분 단위가 아니에요[\s\S]*[0-9]+'/);
  assert.match(card, /가로축은 득점 순서입니다/);
  assert.equal(api.analysisCard({analysis:built.snapshot}), '');
  assert.equal(api.analysisCard({aom:'주홍',analysis:null}), '');
}

{
  const events=exampleEvents();
  assert.equal(api.pmFinalize(match(), events, [], after).ready, false, 'deadline with no votes');
  assert.equal(api.pmBuild(match(), events, [], after).ok, false);
  assert.equal(api.pmFinalize(match({aom:'주홍',kick:0,end:0}), events, votesFor('가'), after).ready, false, 'name and no end');
  const early=api.pmFinalize(match(), events, votesFor('가'), kick+10*60*1000);
  assert.equal(early.win, '가');
  assert.equal(early.ended, false);
  assert.equal(early.ready, false, 'AOM before match end');
  const all=black.concat(blue).map((p,i)=>({voter:'u'+i,p,ts:kick+1000+i}));
  const soon=api.pmFinalize(match(), events, all, kick+5*60*1000);
  assert.equal(soon.why, '전원 투표');
  assert.equal(soon.ready, false);
  const later=api.pmFinalize(match(), events, all, after);
  assert.equal(later.ready, true);
  assert.equal(later.win.length>0, true);
}

{
  const events=[{p:'가나',k:'골',t:'A',eid:'1'},{p:'다라',k:'골',t:'B',eid:'2'}];
  const m=match({A:{name:'블랙',players:['가나','다라']},B:{name:'블루',players:['하']}});
  const votes=[{voter:'1',p:'다라',ts:kick+1},{voter:'2',p:'가나',ts:kick+2}];
  const tied=api.pmFinalize(m, events, votes, after);
  assert.equal(tied.ready, true);
  assert.equal(tied.win, '가나');
  assert.match(tied.tb, /이름순/);
  const late=[{voter:'1',p:'가나',ts:end+40*60*1000}];
  assert.equal(api.pmFinalize(match(), exampleEvents(), late, after).win, '');
}

{
  const events=exampleEvents().slice().reverse();
  const built=api.pmBuild(match(), events, votesFor('가'), [{text:'의견'}], after);
  assert.equal(built.snapshot.observed.flow[0].p, events.find(e=>e.k==='골'||e.k==='자책골').p);
  const doc={matches:{'m-test':match()}};
  const req=api.pmSaveRequest('m-test', built.snapshot);
  assert.deepEqual(Object.keys(req).sort(), ['id','op','snapshot']);
  assert.equal(req.snapshot.ready, false);
  assert.throws(()=>api.pmSaveRequest('m-test', Object.assign({}, built.snapshot, {ready:true})));
  const first=api.pmApplyWrite(doc, req);
  assert.equal(first.created, true);
  assert.equal(first.match.analysis.ready, true);
  const other=JSON.parse(JSON.stringify(req));
  other.snapshot.observed.facts=['다른 분석'];
  other.snapshot.asOf=1;
  const second=api.pmApplyWrite(doc, other);
  assert.equal(second.created, false);
  assert.notEqual(second.match.analysis.observed.facts[0], '다른 분석');
  assert.equal(api.pmApplyWrite(doc, Object.assign({uid:'x'}, req)).applied, false);
  const card=api.analysisCard(first.match);
  assert.match(card, /id="postmatch"/);
  const again=api.analysisCard(first.match);
  assert.equal(again, card);
}

{
  const scoreAt=html.indexOf('점수 = 골 +1');
  const cardAt=html.indexOf('${analysisCard(D)}');
  const tsetAt=html.indexOf('${TSET(D,EV)}');
  assert.ok(scoreAt>0 && scoreAt<cardAt && cardAt<tsetAt);
  const render=html.slice(html.indexOf('function renderIn'), html.indexOf('function ovPick'));
  assert.equal(render.includes('pmBuild('), false);
  assert.equal(render.includes('pmSaveRequest('), false);
  assert.equal(render.includes('fetch('), false);
  assert.match(html, /D\.analysis=pmReady\(m\.analysis\)\?m\.analysis:null/);
  assert.doesNotMatch(block[1], /fetch\(|localStorage|XMLHttpRequest|generativelanguage|openai/);
  const version=JSON.parse(readFileSync(new URL('../achuk/version.json', import.meta.url), 'utf8'));
  assert.equal(version.b, 'anon-20261107081000');
  assert.match(html, /const B='anon-20261107081000'/);
}

console.log('achuk analysis tests ok');
