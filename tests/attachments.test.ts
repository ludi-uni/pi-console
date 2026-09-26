import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareAttachments } from '../server/runtime/attachments.ts';

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
test('attachment validation rejects paths, spoofed formats, binary and unbounded content', () => {
  assert.throws(() => prepareAttachments('', []), /message or attachment/);
  assert.throws(() => prepareAttachments('Hi', [{kind:'text',name:'../secret',mimeType:'text/plain',text:'hi'}]), /invalid attachment/);
  assert.throws(() => prepareAttachments('Hi', [{kind:'image',name:'bad.png',mimeType:'image/png',data:Buffer.from('not png').toString('base64')}]), /image content/);
  assert.throws(() => prepareAttachments('Hi', [{kind:'text',name:'bin',mimeType:'application/octet-stream',text:'wrong'}]), /unsupported attachment/);
  assert.throws(() => prepareAttachments('Hi', [{kind:'text',name:'big.txt',mimeType:'text/plain',text:'x'.repeat(65 * 1024)}]), /64 KiB/);
  assert.throws(() => prepareAttachments('Hi', Array(5).fill({kind:'text',name:'a.txt',mimeType:'text/plain',text:'x'})), /up to 4/);
});
