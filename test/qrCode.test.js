'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQrCodePng } = require('../src/qrCode');

test('creates a downloadable PNG QR code for a short URL', async () => {
  const png = await createQrCodePng('https://azhk.in/example');

  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1000);
});