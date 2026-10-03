import { readFile } from 'node:fs/promises';
import { summarizeTelemetryLines } from '../src/core/telemetry-report.js';

const filePath = process.argv[2];
if (filePath && process.argv.length > 3) throw new Error('Usage: npm run telemetry:report -- [JSONL-file]; without a file, read journalctl JSON lines from stdin.');
if (!filePath && process.stdin.isTTY) throw new Error('Pipe privacy-filtered telemetry JSON lines to stdin, or pass a JSONL file path.');
const text = filePath ? await readFile(filePath, 'utf8') : await (async () => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
})();
process.stdout.write(`${JSON.stringify(summarizeTelemetryLines(text.split(/\r?\n/).filter(Boolean)), null, 2)}\n`);
