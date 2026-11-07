// Layout and animation rules for the iPad board. Mocks only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('../achuk/board/index.html', import.meta.url), 'utf8');
const rt = readFileSync(new URL('../achuk-rt/board/index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ FX-BEGIN\n([\s\S]*?)\n\/\/ FX-END/);
assert.ok(block);
const api = new Function(block[1] + '\nreturn {fxAdmit,fxTone,scoreSide};')();
const start = 1_000_000;

function step(seen, e, force){
  return api.fxAdmit(e, seen, force, start);
}

{
  let seen = {};
  const old = step(seen, {eid:'old', k:'골', t:'A', p:'김', ts:start - 5000}, false);
  assert.equal(old.play, false);
  seen = old.seen;
  const again = step(seen, {eid:'old', k:'골', t:'A', p:'김', ts:start + 10}, false);
  assert.equal(again.play, false, 'initial event is not replayed after refresh');
  const goal = step(seen, {eid:'g1', k:'골', t:'A', p:'김', ts:start + 10}, true);
  assert.equal(goal.play, true);
  assert.equal(goal.tone, 'goal');
  const dup = step(goal.seen, {eid:'g1', k:'골', t:'A', p:'김', ts:start + 11}, true);
  assert.equal(dup.play, false);
  const assist = step(dup.seen, {eid:'a1', k:'어시', t:'A', p:'이', ts:start + 12}, true);
  assert.equal(assist.play, true);
  assert.equal(assist.tone, 'soft');
  const save = step(assist.seen, {eid:'s1', k:'세이브', t:'B', p:'박', ts:start + 13}, true);
  assert.equal(save.tone, 'soft');
  assert.equal(api.scoreSide({k:'자책골', t:'A'}), 'B');
  assert.equal(api.scoreSide({k:'골', t:'B'}), 'B');
  assert.equal(api.scoreSide({k:'어시', t:'A'}), 'A');
}

assert.match(html, /prefers-reduced-motion:reduce/);
assert.match(html, /#swb\{[^}]*background:#ffc65a/);
assert.match(html, /pointer-events:none/);
assert.equal(html.includes('Audio('), false);
assert.equal(rt, html);

function contrast(fg, bg){
  const lum = hex => {
    const n = parseInt(hex.slice(1), 16);
    const p = [n >> 16, (n >> 8) & 255, n & 255].map(c => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  };
  const L1 = lum(fg), L2 = lum(bg);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
assert.ok(contrast('#111111', '#ffffff') >= 7);
assert.ok(contrast('#041e5c', '#ffffff') >= 7);
assert.ok(contrast('#111111', '#ffc65a') >= 4.5);
assert.ok(contrast('#ffffff', '#111111') >= 7);

console.log('achuk board ux unit ok');
