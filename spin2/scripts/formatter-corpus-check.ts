// scripts/formatter-corpus-check.ts
//
// Release gate: format every .spin2 file in a corpus of real projects with the shipped
// formatter, then require that
//   - the original and the formatted project compile to identical bytes with pnut-ts,
//     with and without -d, and
//   - every statement in every method keeps its block depth.
// The corpus (TEST-FORMATTER, gitignored) holds whole projects, so each project is copied
// and formatted as a whole: objects compile against their formatted children.
//
// Run from spin2/:   npm run test:formatter:corpus [-- CORPUS_DIR]
// Exit status 0 when every check passes, 1 otherwise.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { ElasticTabstopConfig } from '../server/src/formatter/spin2.formatter.base';
import { assertBlockDepthsPreserved, formatSpin2Text } from '../server/src/test/formatter/formatter.test-utils';

const corpusDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'TEST-FORMATTER'));

// The shipped IronSheep elastic profile, as in formatter.safety.test.ts
const IRONSHEEP: ElasticTabstopConfig = {
  enabled: true,
  commentGap: 0,
  tabStops: {
    con: [2, 8, 16, 18, 32, 56, 78, 80],
    var: [2, 8, 22, 32, 56, 80],
    obj: [2, 8, 16, 18, 32, 56, 80],
    pub: [2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80],
    pri: [2, 4, 6, 8, 10, 12, 14, 16, 32, 56, 80],
    dat: [8, 14, 24, 32, 48, 56, 80]
  }
};
const CONFIGS: { name: string; elastic?: ElasticTabstopConfig }[] = [{ name: 'spaces' }, { name: 'elastic-IronSheep', elastic: IRONSHEEP }];

function say(text: string): void {
  process.stdout.write(`${text}\n`);
}

function compile(dir: string, file: string, debug: boolean): Buffer | undefined {
  try {
    execSync(`pnut-ts -q ${debug ? '-d ' : ''}"${file}"`, { cwd: dir, stdio: 'pipe' });
    return fs.readFileSync(path.join(dir, file.replace(/\.spin2$/, '.bin')));
  } catch {
    return undefined;
  }
}

function copyProject(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    // stored binaries from the retired GOLD design are not inputs
    if (fs.statSync(src).isFile() && !name.endsWith('.GOLD')) {
      fs.copyFileSync(src, path.join(to, name));
    }
  }
}

function main(): number {
  if (!fs.existsSync(corpusDir)) {
    say(`corpus not found: ${corpusDir}`);
    return 1;
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'formatter-corpus-'));
  const failures: string[] = [];
  let compared = 0;
  let notCompiling = 0;
  try {
    const projects = fs.readdirSync(corpusDir).filter((d) => fs.statSync(path.join(corpusDir, d)).isDirectory());
    for (const project of projects) {
      const files = fs.readdirSync(path.join(corpusDir, project)).filter((f) => f.endsWith('.spin2'));
      for (const cfg of CONFIGS) {
        const origDir = path.join(work, cfg.name, project, 'original');
        const fmtDir = path.join(work, cfg.name, project, 'formatted');
        copyProject(path.join(corpusDir, project), origDir);
        copyProject(path.join(corpusDir, project), fmtDir);
        for (const f of files) {
          const text = fs.readFileSync(path.join(origDir, f), 'utf-8');
          const formatted = formatSpin2Text(text, {}, cfg.elastic);
          fs.writeFileSync(path.join(fmtDir, f), formatted, 'utf-8');
          try {
            assertBlockDepthsPreserved(text, formatted, `${cfg.name} ${project}/${f}`);
          } catch (err) {
            failures.push((err as Error).message);
          }
        }
        for (const f of files) {
          for (const debug of [false, true]) {
            const original = compile(origDir, f, debug);
            if (original === undefined) {
              notCompiling++;
              continue;
            }
            compared++;
            const formatted = compile(fmtDir, f, debug);
            if (formatted === undefined) {
              failures.push(`${cfg.name} ${project}/${f} (${debug ? 'with' : 'without'} -d): formatted source does not compile`);
            } else if (!formatted.equals(original)) {
              failures.push(`${cfg.name} ${project}/${f} (${debug ? 'with' : 'without'} -d): binary differs`);
            }
          }
        }
      }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  say(`compiled and compared ${compared}, original did not compile ${notCompiling}, failures ${failures.length}`);
  for (const failure of failures) {
    say(`FAIL ${failure}`);
  }
  return failures.length === 0 ? 0 : 1;
}

process.exit(main());
