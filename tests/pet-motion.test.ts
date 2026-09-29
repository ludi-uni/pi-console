import { test } from 'node:test';
import assert from 'node:assert/strict';
import { petFrameMs, clampPet, selectPet } from '../web/PetWidget.tsx';
import { defaultPreferences } from '../web/preferences.ts';

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

test('first launch displays bundled Fio by default',()=>{
  assert.equal(defaultPreferences.petEnabled,true);
  assert.equal(defaultPreferences.petId,'fio');
  assert.equal(defaultPreferences.petSource,'bundled');
});

test('pet selection prefers exact source, then same id, then available Fio, then first',()=>{
  const pets=[{id:'other',source:'codex',displayName:'Other'},{id:'fio',source:'pi-console',displayName:'Custom Fio'},{id:'fio',source:'bundled',displayName:'Bundled Fio'},{id:'legacy',source:'pi-console',displayName:'Legacy'}];
  assert.deepEqual(selectPet(pets,'fio','bundled'),pets[2]);
  assert.deepEqual(selectPet(pets,'legacy','missing'),pets[3]);
  assert.deepEqual(selectPet(pets,'missing','missing'),pets[1]);
  assert.deepEqual(selectPet(pets,'','missing'),pets[1]);
  assert.deepEqual(selectPet([pets[0]],'fio','bundled'),pets[0]);
  assert.equal(selectPet([],'fio','bundled'),undefined);
});
