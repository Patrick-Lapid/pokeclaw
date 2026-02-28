#!/usr/bin/env node

const { startServer } = require('./server');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: agentdex [options]');
  console.log('');
  console.log('Options:');
  console.log('  --port <number>  Port to listen on (default: 3000)');
  console.log('  --no-open        Do not auto-open browser');
  console.log('  --help, -h       Show this help message');
  process.exit(0);
}

let port = 3000;
const portIdx = args.indexOf('--port');
if (portIdx !== -1 && args[portIdx + 1]) {
  const p = parseInt(args[portIdx + 1], 10);
  if (!isNaN(p) && p > 0 && p < 65536) {
    port = p;
  }
}

const noOpen = args.includes('--no-open');

startServer({ port, open: !noOpen });
