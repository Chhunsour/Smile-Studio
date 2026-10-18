/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFieldDraft, reconcileFieldDraft } from './drafts.ts';

test('external Undo A to B to A overrides the old text draft instead of reviving B', () => {
  const first = { text: 'A', start: '00:00:01.000', end: '00:00:03.000' };
  let draft = createFieldDraft(first);
  draft = { ...draft, values: { ...draft.values, text: 'B' } };
  draft = reconcileFieldDraft(draft, { ...first, text: 'B' });
  assert.equal(draft.values.text, 'B');
  draft = reconcileFieldDraft(draft, first);
  assert.equal(draft.values.text, 'A', 'Undo must show the restored model value');
  draft = reconcileFieldDraft(draft, { ...first, text: 'B' });
  assert.equal(draft.values.text, 'B', 'Redo shows its model value');
});

test('text saves preserve uncommitted timing fields, while external shifts replace their fields', () => {
  const source = { text: 'សួស្តី', start: '00:00:01.000', end: '00:00:03.000' };
  const before = createFieldDraft(source);
  const pending = { ...before, values: { ...before.values, start: '00:00:01.500', end: '00:00:02.500' } };
  const typed = reconcileFieldDraft(pending, { ...source, text: 'សួស្តី Smile' });
  assert.deepEqual(typed.values, { text: 'សួស្តី Smile', start: '00:00:01.500', end: '00:00:02.500' });
  const shifted = reconcileFieldDraft(typed, { text: 'សួស្តី Smile', start: '00:00:02.000', end: '00:00:04.000' });
  assert.deepEqual(shifted.values, { text: 'សួស្តី Smile', start: '00:00:02.000', end: '00:00:04.000' });
  assert.deepEqual(before.values, source, 'older draft snapshots remain immutable');
});

test('timing Apply then Undo cannot revive old source trim values', () => {
  const source = { start: '1', end: '5', at: '2' };
  let draft = createFieldDraft(source);
  draft = { ...draft, values: { ...draft.values, start: '2', end: '4' } };
  draft = reconcileFieldDraft(draft, { start: '2', end: '4', at: '2' });
  draft = reconcileFieldDraft(draft, source);
  assert.deepEqual(draft.values, source);
  assert.equal(reconcileFieldDraft(draft, { ...source }), draft, 'unchanged external values never trigger a render update');
});

test('blank and partial user input stays local until an actual external value changes', () => {
  const draft = createFieldDraft({ text: 'Caption', start: '1.5' });
  const pending = { ...draft, values: { text: '', start: '00:' } };
  assert.equal(reconcileFieldDraft(pending, { text: 'Caption', start: '1.5' }), pending);
  const external = reconcileFieldDraft(pending, { text: 'Restored caption', start: '1.5' });
  assert.deepEqual(external.values, { text: 'Restored caption', start: '00:' });
});
