import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADJUST_LABELS, DEFAULT_ADJUST, BEAUTY_PRESETS, normalizeAdjust, needsFaces, isNeutral } from '../src/beauty-settings.js';

test('older saved edits keep their values, while new controls default to zero and invalid values are bounded',()=>{
  const old=normalizeAdjust({smooth:35,whiten:20,slim:15,blush:7,filter:'mono'});
  assert.equal(old.smooth,35);assert.equal(old.filter,'mono');
  for(const key of ['eyeSize','irisSize','nose','mouth','darkCircles','lips'])assert.equal(old[key],0);
  const bounded=normalizeAdjust({smooth:-10,nose:700,lips:'25',mouth:NaN,filter:'unknown'});
  assert.equal(bounded.smooth,0);assert.equal(bounded.nose,100);assert.equal(bounded.lips,25);assert.equal(bounded.mouth,0);assert.equal(bounded.filter,'original');
  assert.equal(isNeutral(DEFAULT_ADJUST),true);
  assert.equal(needsFaces({filter:'mono'}),false);
  for(const key of Object.keys(ADJUST_LABELS))assert.equal(needsFaces({[key]:1}),true,key);
});

test('quick looks are reversible recipes, with no hidden default change or geometry at high strength',()=>{
  for(const preset of BEAUTY_PRESETS) {
    const a=normalizeAdjust(preset.values);
    assert.equal(isNeutral(a),false);
    assert.ok(a.slim<=20 && a.eyeSize<=20 && a.nose<=20 && a.mouth<=20);
    assert.equal(a.filter,'original');
  }
  assert.ok(Object.values(DEFAULT_ADJUST).every(value=>value===0 || value==='original'));
});
