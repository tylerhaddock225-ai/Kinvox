import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SUPABASE_PROJECT_REFS = {
  sandbox: 'ntwimeqxyyvjyrisqofl',
  prod:    'jysnvuqdrfejejosizwo',
};

const VALID_ENVS = ['prod', 'sandbox', 'shared'];

function die(msg) {
  console.error(`run-data-op: ${msg}`);
  process.exit(1);
}

function readLinkedProjectRef() {
  const refPath = resolve(process.cwd(), 'supabase/.temp/project-ref');
  if (!existsSync(refPath)) {
    die('supabase/.temp/project-ref not found — run `npx supabase link --project-ref <ref>` first');
  }
  return readFileSync(refPath, 'utf8').trim();
}

function envFromLinkedRef(ref) {
  for (const [env, projectRef] of Object.entries(SUPABASE_PROJECT_REFS)) {
    if (projectRef === ref) return env;
  }
  return null;
}

function nowIsoUtc() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function appendLog({ env, file, outcome, operator }) {
  const logPath = resolve(process.cwd(), 'supabase/data-ops/_log.md');
  const row = `| ${nowIsoUtc()} | ${env} | ${file} | ${operator} | ${outcome} |\n`;
  appendFileSync(logPath, row);
}

// ---- main ----

const [, , envArg, fileArg] = process.argv;

if (!envArg || !fileArg) {
  die('usage: node --env-file=.env.local scripts/run-data-op.mjs <prod|sandbox|shared> <filename>');
}

if (!VALID_ENVS.includes(envArg)) {
  die(`invalid env "${envArg}". must be one of: ${VALID_ENVS.join(', ')}`);
}

const filePath = resolve(process.cwd(), 'supabase/data-ops', envArg, fileArg);
if (!existsSync(filePath)) {
  die(`file not found: supabase/data-ops/${envArg}/${fileArg}`);
}

if (envArg === 'shared') {
  die('shared/ files must be run explicitly against each target env — invoke this script twice, once per env, after re-linking. For now this wrapper refuses shared invocation to force the conscious step.');
}

const linkedRef = readLinkedProjectRef();
const linkedEnv = envFromLinkedRef(linkedRef);

if (linkedEnv === null) {
  die(`linked project-ref "${linkedRef}" doesn't match any known env. expected one of: ${Object.values(SUPABASE_PROJECT_REFS).join(', ')}`);
}

if (linkedEnv !== envArg) {
  die(`SAFETY HALT: requested env="${envArg}" but Supabase CLI is linked to "${linkedEnv}" (ref ${linkedRef}). re-link with: npx supabase link --project-ref ${SUPABASE_PROJECT_REFS[envArg]}`);
}

console.log(`run-data-op: env=${envArg} file=${fileArg} linked_ref=${linkedRef} — proceeding`);

// Use --file rather than passing SQL as a positional arg: the supabase CLI
// parses any positional starting with "--" (e.g., a SQL comment) as a flag.
// shell:true so Windows can resolve npx via npx.cmd shim.
const result = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--file', filePath], {
  stdio: 'inherit',
  shell: true,
});

const operator = process.env.USER || process.env.USERNAME || 'unknown';

if (result.status !== 0) {
  appendLog({ env: envArg, file: fileArg, outcome: `FAILED (exit ${result.status})`, operator });
  die(`supabase db query exited with status ${result.status}`);
}

appendLog({ env: envArg, file: fileArg, outcome: 'ok', operator });
console.log(`run-data-op: done. log row appended to supabase/data-ops/_log.md — remember to commit the log.`);
