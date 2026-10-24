// Run after every build. Keeps secrets out of anything that gets uploaded:
//   1. removes the secrets file and its template from the built API folder;
//   2. fails the build if any built file still contains a value from the secrets files or something shaped like
//      a Stripe webhook secret, a Resend key or a Google Apps Script URL.
// It never prints a secret, only which file matched and why.
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--')) ?? 'dist');
const sources = args.filter((a) => a.startsWith('--secrets=')).map((a) => resolve(a.slice('--secrets='.length)));
if (sources.length === 0) sources.push(resolve('public/api/config.secrets.example.php'), resolve('public/api/config.secrets.php'));

if (!existsSync(dir)) {
  console.error(`strip-private: ${dir} does not exist`);
  process.exit(1);
}

for (const name of ['config.secrets.php', 'config.secrets.example.php']) {
  const file = join(dir, 'api', name);
  if (existsSync(file)) {
    rmSync(file);
    console.log(`strip-private: removed ${relative(process.cwd(), file)}`);
  }
}

// String values in the secrets files that are not placeholders and are long enough to be real.
const known = [];
for (const source of sources) {
  if (!existsSync(source)) continue;
  for (const m of readFileSync(source, 'utf8').matchAll(/=>\s*'([^']{16,})'/g)) {
    if (!/PASTE/i.test(m[1])) known.push(m[1]);
  }
}

const shapes = [
  [/whsec_[A-Za-z0-9]{16,}/, 'a Stripe webhook secret'],
  [/\bre_[A-Za-z0-9_]{20,}/, 'a Resend API key'],
  [/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec/, 'a Google Apps Script URL'],
];
const binary = /\.(woff2?|png|jpe?g|gif|ico|webp|zip)$/i;

function* files(d) {
  for (const entry of readdirSync(d)) {
    const full = join(d, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

const problems = [];
for (const file of files(dir)) {
  if (binary.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  const rel = relative(process.cwd(), file);
  for (const [re, what] of shapes) if (re.test(text)) problems.push(`${rel}: looks like ${what}`);
  known.forEach((value, i) => {
    if (text.includes(value)) problems.push(`${rel}: contains value #${i + 1} from a secrets file`);
  });
}

if (problems.length) {
  console.error('strip-private: secrets found in the build. Do not upload it.');
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log(`strip-private: ${dir} is clear of secrets`);
