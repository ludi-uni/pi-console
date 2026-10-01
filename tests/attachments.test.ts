import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareAttachments } from '../server/runtime/attachments.ts';
import { splitPromptAttachments, decodeUtf8 } from '../shared/attachments.ts';

const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
test('text and image attachments become Pi prompt text and ImageContent, never server file paths', () => {
  const result = prepareAttachments('Describe these', [
    { kind: 'text', name: 'notes.md', mimeType: 'text/markdown', text: 'A fact from the file.' },
    { kind: 'image', name: 'figure.png', mimeType: 'image/png', data: png },
  ]);
  assert.match(result.message, /<attached_file name="notes.md">\nA fact from the file\./);
  assert.match(result.message, /\[Attached image: figure.png\]/);
  assert.deepEqual(result.images, [{ type: 'image', data: png, mimeType: 'image/png' }]);
  assert.ok(!result.message.includes(png));
});
test('attachment markers let the chat split metadata without dropping typed text', () => {
  const prepared = prepareAttachments('Review <attached_file name="mine.txt"> stays', [
    { kind: 'text', name: 'a & "b".txt', mimeType: 'text/plain', text: 'body <here>' },
    { kind: 'image', name: 'pic.png', mimeType: 'image/png', data: png },
  ]);
  const split = splitPromptAttachments(prepared.message);
  assert.equal(split.attachments.length, 2);
  assert.equal(split.attachments[0].name, 'a & "b".txt');
  assert.equal(split.attachments[0].preview, 'body <here>');
  assert.equal(split.attachments[1].kind, 'image');
  assert.ok(!split.text.includes('body <here>'), 'file bodies stay out of the visible text');
  assert.ok(split.text.includes('stays'), 'typed lookalike tags are never stripped');
  assert.ok(!prepared.message.includes(png), 'image base64 never enters the prompt text');
  const userTyped = splitPromptAttachments('literal <pi_attachment kind="text" name="x"> note');
  assert.equal(userTyped.attachments.length, 0);
  assert.ok(userTyped.text.includes('<pi_attachment'));
});
test('payload bytes keep bodies with closing tags and nested markers fully hidden', () => {
  const body = 'line1 </attached_file> still body <pi_attachment kind="text" name="x"> 日本語本文';
  const prepared = prepareAttachments('go', [
    { kind: 'text', name: 'tricky.txt', mimeType: 'text/plain', text: body },
    { kind: 'text', name: '二"番&目<.txt', mimeType: 'text/plain', text: 'second' },
    { kind: 'image', name: "o']shot.png", mimeType: 'image/png', data: png },
  ]);
  const split = splitPromptAttachments(prepared.message);
  assert.equal(split.text, 'go');
  assert.equal(split.attachments.length, 3);
  assert.equal(split.attachments[0].preview, body.slice(0, 1200));
  assert.equal(split.attachments[1].name, '二"番&目<.txt');
  assert.equal(split.attachments[1].mimeType, 'text/plain');
  assert.equal(split.attachments[2].name, "o']shot.png");
  assert.ok(!split.text.includes('still body'));
  // A bare user-typed image marker without its exact note line stays literal.
  const typed = splitPromptAttachments('see <pi_attachment kind="image" name="t.png"/> end');
  assert.equal(typed.attachments.length, 0);
  assert.ok(typed.text.includes('<pi_attachment'));
  // Attachment-only sends keep the metadata even with empty typed text.
  const only = splitPromptAttachments(prepareAttachments('', [{ kind: 'image', name: 'pic.png', mimeType: 'image/png', data: png }]).message);
  assert.equal(only.text, '');
  assert.equal(only.attachments.length, 1);
  assert.equal(only.attachments[0].name, 'pic.png');
  // UTF-8 decoding is fatal: binary must not become silent replacement text.
  assert.throws(() => decodeUtf8(Uint8Array.from([0xff, 0xfe, 0x00])), /UTF-8/);
  assert.equal(decodeUtf8(new TextEncoder().encode('日本語 ok')), '日本語 ok');
});
test('attachment validation rejects paths, spoofed formats, binary and unbounded content', () => {
  assert.throws(() => prepareAttachments('', []), /message or attachment/);
  assert.throws(() => prepareAttachments('Hi', [{kind:'text',name:'../secret',mimeType:'text/plain',text:'hi'}]), /invalid attachment/);
  assert.throws(() => prepareAttachments('Hi', [{kind:'image',name:'bad.png',mimeType:'image/png',data:Buffer.from('not png').toString('base64')}]), /image content/);
  assert.throws(() => prepareAttachments('Hi', [{kind:'text',name:'bin',mimeType:'application/octet-stream',text:'wrong'}]), /unsupported attachment/);
  assert.throws(() => prepareAttachments('Hi', [{kind:'text',name:'big.txt',mimeType:'text/plain',text:'x'.repeat(65 * 1024)}]), /64 KiB/);
  assert.throws(() => prepareAttachments('Hi', Array(5).fill({kind:'text',name:'a.txt',mimeType:'text/plain',text:'x'})), /up to 4/);
});
