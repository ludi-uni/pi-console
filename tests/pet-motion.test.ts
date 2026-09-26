import { test } from 'node:test';
import assert from 'node:assert/strict';
import { petFrameMs, clampPet } from '../web/PetWidget.tsx';

test('Codex idle blink is calm; walk, drag and Pi reactions have independent frame rates',()=>{
  assert.equal(petFrameMs('idle',0),2100);
  assert.equal(petFrameMs('idle',1),150);
  assert.equal(petFrameMs('idle',4),150);
  assert.equal(petFrameMs('walk-right',0),320);
  assert.equal(petFrameMs('walk-left',0,true),155);
  assert.equal(petFrameMs('running',0),145);
  assert.equal(petFrameMs('waiting',0),280);
  assert.equal(petFrameMs('review',0),250);
  assert.equal(petFrameMs('failed',0),200);
  assert.equal(petFrameMs('completed',0),165);
  assert.deepEqual(clampPet(-100,999,96,104,320,700),{x:4,y:592});
});
