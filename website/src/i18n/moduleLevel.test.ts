/**
 * `i18nT()` must not be evaluated at module load.
 *
 * A call in module scope runs once, when the module is first imported — before the
 * user has picked a language, and never again. The string it returns is frozen at
 * the boot language for the life of the tab, so the nav rail or a tab table stays
 * English while everything around it translates. That is the defect `labelKey` +
 * `surfaceLabel()` exists to fix, and the codemod already skips these sites on
 * purpose (`insideFunction()` in `scripts/i18n-codemod.mjs`).
 *
 * ## Why this uses the TypeScript AST and `dynamicKeys.test.ts` uses a regex
 *
 * Because the distinction is genuinely syntactic. These are safe — the call sits
 * inside a function body and runs per invocation:
 *
 *     const label = (t: string) => i18nT('a.b')
 *     function label() { return i18nT('a.b') }
 *
 * and these are not — the call runs at import:
 *
 *     const LABEL = i18nT('a.b')
 *     const TABS = [{ label: i18nT('a.b') }]
 *
 * A regex cannot separate them reliably: an arrow function with an expression body
 * has no brace to count, so a depth counter reports `const f = () => i18nT(…)` as
 * module scope. `typescript` is already a
 * devDependency and the codemod already walks the AST for the same question, so the
 * correct tool is available.
 *
 * ## Why the scan is one case PER FILE
 *
 * This gate asserts something about file *contents*; it does not care how long the
 * reading takes. Scanning the whole tree inside a single `it()` nevertheless put the
 * config-wide 15s `testTimeout` (`vite.config.ts`) around work that is linear in the
 * tree and paced by the host, so the budget measured the MACHINE rather than the
 * code: identical source passed on an idle machine and failed with `Test timed out
 * in 15000ms` when the rest of the suite ran alongside it. That is flake class 5 in
 * `docs/system-specs/common/testing-conventions.md` § Determinism, and raising the
 * budget is the fix that doc rules out by name — it banks the overhead as headroom
 * and hides the next real regression.
 *
 * One case per file leaves the budget where it is and shrinks what it bounds to a
 * CONSTANT: a single file, whatever the tree grows to. The margin stops being a few
 * multiples of the whole-tree scan and becomes several thousand times one file's, so
 * it survives both a loaded host and coverage instrumentation, and it no longer
 * erodes as the codebase grows. A file that is genuinely pathological to parse still
 * trips the clock, and it names itself when it does.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const SRC = join(__dirname, '..')

/** The translate function's own declaration is not a call site. */
const NOT_A_CALL_SITE = new Set(['i18n/t.ts'])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'locales') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Line numbers of `i18nT(...)` calls that are not lexically inside any function.
 *
 * Class bodies count as module scope for a property initialiser, since those also
 * run at construction rather than at render.
 */
function moduleLevelCalls(file: string, source: string): number[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: number[] = []

  const isFunctionLike = (n: ts.Node) =>
    ts.isFunctionDeclaration(n)
    || ts.isFunctionExpression(n)
    || ts.isArrowFunction(n)
    || ts.isMethodDeclaration(n)
    || ts.isConstructorDeclaration(n)
    || ts.isGetAccessor(n)
    || ts.isSetAccessor(n)

  const visit = (node: ts.Node, insideFunction: boolean) => {
    if (
      !insideFunction
      && ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'i18nT'
    ) {
      hits.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    }
    const nowInside = insideFunction || isFunctionLike(node)
    ts.forEachChild(node, (child) => visit(child, nowInside))
  }

  visit(sf, false)
  return hits
}

const ADVICE =
  'A module-scope `i18nT()` runs once at import, before the user has chosen a '
  + 'language, and never re-runs — so the string freezes at the boot language. Move '
  + 'the call inside the component or the render callback, or store the KEY in your '
  + 'table and translate at render (see `labelKey` + `surfaceLabel()` in '
  + '`surfaces/registry.ts`).'

describe('i18nT is never evaluated at module load', () => {
  const files = walk(SRC).filter(
    (f) => !NOT_A_CALL_SITE.has(relative(SRC, f).split('\\').join('/')),
  )

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(300)
  })

  // One case per file — see the header for why the whole-tree scan was split up.
  // The rule is per file to begin with (a file either holds a module-scope call or
  // it does not), so nothing here is aggregated and a failure names its own file.
  for (const file of files) {
    const rel = relative(SRC, file).split('\\').join('/')
    it(`no module-scope i18nT() call in ${rel}`, () => {
      const source = readFileSync(file, 'utf-8')
      if (!source.includes('i18nT(')) return
      const lines = source.split('\n')
      const offenders = moduleLevelCalls(rel, source).map(
        (lineNo) => `${rel}:${lineNo}  ${(lines[lineNo - 1] ?? '').trim()}`,
      )
      expect(offenders, ADVICE).toEqual([])
    })
  }
})
