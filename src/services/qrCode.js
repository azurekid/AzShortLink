'use strict';

const QRCode = require('qrcode');

function createQrCodePng(url) {
  return QRCode.toBuffer(url, {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#ffffff' }
  });
}

module.exports = { createQrCodePng };