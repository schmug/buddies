#!/usr/bin/env node
/**
 * Type-check gate for TEST code (BLOCKING).
 *
 * `tsconfig.app.json` excludes `src/test` and `src/**\/*.test.ts(x)`, and never
 * included `integration/` or `playwright/`, so the entire test tree was compiled
 * by nothing: a `const x: number = 's'` in any of those files exited 0. This runs
 * `tsc` over `tsconfig.test.json` — which does include them — and compares the
 * result against a per-file baseline of the errors that already existed when the
 * gate was introduced.
 *
 * WHY A BASELINE RATHER THAN A REFERENCE FROM tsconfig.json. The honest fix is
 * `{ "path": "./tsconfig.test.json" }` in tsconfig.json's `references`, so plain
 * `tsc -b` covers tests. That cannot land while the test tree carries hundreds of
 * pre-existing errors: it would turn `npm run build` red for everyone. So the
 * backlog is recorded once, exactly, and this gate fails on anything beyond it.
 * When the baseline reaches zero, delete it with this script and add the
 * reference instead.
 *
 * THE COMPARISON IS EXACT IN BOTH DIRECTIONS. A file whose count goes UP is a
 * regression; a file whose count goes DOWN (or disappears) is an improvement that
 * must shrink the baseline in the same commit, or the ratchet rots and silently
 * re-opens room for new errors. Both failures are diff-scoped — the counts are a
 * pure function of the tree, not a stored whole-repo total that another branch can
 * move under you — so a PR is only ever charged for files its own diff affects.
 *
 * FAILING CLOSED. A gate that cannot run must fail, not pass. If `tsc` exits
 * non-zero but this script parses no diagnostics out of its output, that is a
 * broken parser or a crashed compiler, not a clean tree — it exits non-zero and
 * prints the raw output rather than reporting "0 errors".
 *
 * Usage:
 *   node scripts/check-test-types.mjs            # check, exit 1 on any drift
 *   node scripts/check-test-types.mjs --update   # rewrite the baseline
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PROJECT = 'tsconfig.test.json'
const BASELINE = join(ROOT, 'tsconfig.test.baseline.json')

// `path(line,col): error TSxxxx: message`. Continuation lines of a multi-line
// diagnostic are indented, so anchoring on a non-space first character counts
// each diagnostic exactly once.
const DIAGNOSTIC_RE = /^(\S[^(]*)\((\d+),(\d+)\): error (TS\d+): /

/** Diagnostics printed per regressed file before the rest are summarized. */
const DIAGNOSTIC_SAMPLE = 10

/** Run tsc over the test project and return { code, output }. */
function runTsc() {
  // `--pretty false` keeps the output as plain `path(l,c): error TSxxxx:` lines:
  // the pretty renderer adds ANSI color and reflows diagnostics, and tsc turns it
  // on by default whenever stdout is a TTY, which would make this parse locally
  // but not in CI (or the reverse).
  const res = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '-p', PROJECT, '--noEmit', '--pretty', 'false'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (res.error) {
    console.error(`Could not run tsc: ${res.error.message}`)
    process.exit(1)
  }
  return { code: res.status, output: `${res.stdout || ''}${res.stderr || ''}` }
}

/** Fold tsc output into { "<repo-relative path>": <error count> }. */
function countByFile(output) {
  const counts = {}
  for (const line of output.split('\n')) {
    const m = DIAGNOSTIC_RE.exec(line)
    if (!m) continue
    // tsc emits host separators; the baseline is committed with POSIX ones so a
    // Windows checkout does not rewrite every key.
    const file = m[1].replace(/\\/g, '/')
    counts[file] = (counts[file] || 0) + 1
  }
  return counts
}

function sortedByKey(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

const update = process.argv.includes('--update')
const { code, output } = runTsc()
const current = countByFile(output)
const total = Object.values(current).reduce((a, b) => a + b, 0)

// Fail closed: tsc complained but nothing parsed, so the parser and the compiler
// disagree about the output format and every real error would read as zero.
if (code !== 0 && total === 0) {
  console.error(`tsc -p ${PROJECT} exited ${code} but no diagnostics could be parsed from its output.`)
  console.error('This gate cannot report on output it does not understand. Raw output follows:\n')
  console.error(output.trim() || '(empty)')
  process.exit(1)
}

if (update) {
  writeFileSync(BASELINE, `${JSON.stringify(sortedByKey(current), null, 2)}\n`)
  console.log(`Wrote ${BASELINE}: ${total} error(s) across ${Object.keys(current).length} file(s).`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error(`Missing ${BASELINE}. Generate it with: npm run typecheck:tests -- --update`)
  process.exit(1)
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))

const regressions = []
const improvements = []
for (const file of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
  const now = current[file] || 0
  const was = baseline[file] || 0
  if (now > was) regressions.push({ file, now, was })
  else if (now < was) improvements.push({ file, now, was })
}

if (regressions.length) {
  console.error(`Type errors in test code beyond the recorded baseline (${PROJECT}):\n`)
  for (const { file, now, was } of regressions) {
    console.error(`  ${file}: ${was} -> ${now}`)
    // A file already carrying baselined debt can hold hundreds of diagnostics and
    // the count alone cannot say which are new, so print a readable sample rather
    // than burying the summary under the whole set.
    const lines = output
      .split('\n')
      .filter((line) => line.replace(/\\/g, '/').startsWith(`${file}(`))
    for (const line of lines.slice(0, DIAGNOSTIC_SAMPLE)) console.error(`      ${line.trim()}`)
    if (lines.length > DIAGNOSTIC_SAMPLE) {
      console.error(`      … ${lines.length - DIAGNOSTIC_SAMPLE} more; see \`npx tsc -p ${PROJECT} --noEmit\``)
    }
  }
  console.error('\nFix the type errors. The baseline records pre-existing debt only; it does not grow.')
  process.exit(1)
}

if (improvements.length) {
  console.error('Test type errors were fixed but the baseline still records them:\n')
  for (const { file, now, was } of improvements) console.error(`  ${file}: ${was} -> ${now}`)
  console.error('\nShrink the baseline in the same commit: npm run typecheck:tests -- --update')
  process.exit(1)
}

console.log(
  `OK: test type-check matches the baseline (${total} known error(s) across ${Object.keys(current).length} file(s)).`,
)
