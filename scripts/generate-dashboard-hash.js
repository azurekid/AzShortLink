#!/usr/bin/env node
'use strict';

// Generates a bcrypt hash for DASHBOARD_PASSWORD_HASH. Usage: node scripts/generate-dashboard-hash.js <password>
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/generate-dashboard-hash.js <password>');
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 12));
