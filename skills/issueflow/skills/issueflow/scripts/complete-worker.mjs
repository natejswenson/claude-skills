#!/usr/bin/env node
import { completeAttempt } from './lib/attempts.mjs';
try {
  if (process.argv.length !== 3) throw new Error('usage: complete-worker.mjs <attempt-request.json>');
  const result = completeAttempt(process.argv[2]);
  console.log(`Published ${result.id}; finish the native worker turn now.`);
} catch (error) { console.error(error.message); process.exitCode = 2; }
