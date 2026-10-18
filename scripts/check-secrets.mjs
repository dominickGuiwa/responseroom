// Pre-publish check: fails if secrets or local state are tracked, or if tracked files contain key-like strings.
// Run: npm run check:secrets   (scans tracked files and the full git history)
import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const problems = [];
const tracked = git('ls-files').split('\n').filter(Boolean);
for (const f of tracked) if (/(^|\/)\.env(\.|$)(?!example)|\.instructor-key$|\.sqlite/.test(f)) problems.push(`tracked secret/local file: ${f}`);
const patterns = [/capi_[A-Za-z0-9_-]{16,}/, /cr_sk_[A-Za-z0-9_-]{16,}/, /sntrys_[A-Za-z0-9_-]{16,}/, /https:\/\/[0-9a-f]{20,}@[^\s'"]*sentry/, /gh[pousr]_[A-Za-z0-9]{20,}/, /sk-[A-Za-z0-9]{20,}/, /sk_[A-Za-z0-9]{24,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
const scan = (label, text) => { for (const p of patterns) if (p.test(text)) problems.push(`${label}: matches ${p}`) };
for (const f of tracked) if (!/\.(png|jpe?g|gif|ico)$/i.test(f)) scan(f, git('show', 'HEAD:' + f).toString());
scan('git history', git('log', '-p', '--all'));
if (problems.length) { console.error('NOT SAFE TO PUBLISH:\n- ' + problems.join('\n- ')); process.exit(1) }
console.log(`OK: ${tracked.length} tracked files and full history scanned; no secrets or local state found.`);
