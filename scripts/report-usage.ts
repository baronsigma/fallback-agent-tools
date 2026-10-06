import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { summarizeUsageLines } from '../src/core/telemetry-report.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--since' || !args[1] || args[1].startsWith('-')) {
  throw new Error('Usage: npm run usage:report -- --since <journalctl-time> (for example: 24h)');
}

const since = args[1];
const relativeSince = since.match(/^(\d+)(m|h|d|w)$/i);
const journalSince = relativeSince
  ? `${relativeSince[1]} ${({ m: 'minutes', h: 'hours', d: 'days', w: 'weeks' } as const)[relativeSince[2]!.toLowerCase() as 'm' | 'h' | 'd' | 'w']} ago`
  : since;
const exclusionFile = process.env['FALLBACK_INTERNAL_PAYER_FINGERPRINTS_FILE']
  ?? `${process.cwd()}/.local/internal-payer-fingerprints.txt`;
let exclusionsText: string;
try {
  exclusionsText = await readFile(exclusionFile, 'utf8');
} catch {
  throw new Error(`Internal payer exclusion file is required: ${exclusionFile}`);
}
const fingerprints = exclusionsText.split(/\r?\n/).map((value) => value.trim().toLowerCase()).filter(Boolean);
if (fingerprints.some((value) => !/^[\da-f]{64}$/.test(value))) throw new Error('Internal payer exclusion file has an invalid fingerprint.');
if (fingerprints.length === 0) throw new Error('Internal payer exclusion file is empty; refusing to report organic usage without launch exclusions.');

let text: string;
try {
  text = execFileSync('journalctl', ['-u', 'fallback.service', '--since', journalSince, '-o', 'cat'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  throw new Error(`Could not read fallback.service journal: ${error instanceof Error ? error.message : String(error)}`);
}

process.stdout.write(`${JSON.stringify(summarizeUsageLines(text.split(/\r?\n/).filter(Boolean), new Set(fingerprints)), null, 2)}\n`);
