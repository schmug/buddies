/**
 * The authored catalog registry, as a plain-node gate can see it.
 *
 * WHY A GATE NEEDS THIS. A check that tells an author "your English changed, now
 * re-translate" has to name the catalogs, and a number in that sentence is wrong the
 * next time a language ships. Nothing reports the catalogs a low number leaves behind:
 * `check-app-manifest-sync.mjs` reads only `en.json`, and `catalogParity` proves a key
 * is PRESENT, never that its value still translates the current English. So the message
 * is the only thing standing between a changed sentence and a stale catalog, and it has
 * to be right by construction rather than by someone remembering to bump it.
 *
 * WHY IT PARSES SOURCE. `src/i18n/index.ts` cannot be imported from plain node: it
 * needs a bundler for `import.meta.env` and for extension-less JSON imports, and node
 * would have to strip its type annotations. Two properties keep the parse from being
 * the quiet kind of wrong:
 *
 *   1. **Comments are removed first.** A regex over source text also matches source
 *      text inside a comment, which is the exact unsoundness
 *      `check-app-manifest-sync.mjs`'s header warns about — an entry wrapped in a block
 *      comment would otherwise read as bound when the runtime no longer has it.
 *      Stripping first means a commented-out locale is neither bound nor named.
 *   2. **An unreadable registry THROWS.** Never a fallback count, never an empty list.
 *      `i18n-check.mjs` already treats a gate that cannot run as a failure rather than
 *      a pass, and a silent fallback here is precisely how a stale number comes back.
 *
 * The parse is pinned against the real module by `src/test/i18nCatalogRegistry.test.ts`,
 * which imports `AUTHORED_CATALOGS` through vitest's TypeScript pipeline. That is the
 * same division of labour as the manifest gate itself: each half is checked by the tool
 * that can actually see it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const I18N_INDEX = join(HERE, '..', '..', 'src', 'i18n', 'index.ts')

/** The identifier this module reads. Named once so an error can quote it. */
const REGISTRY = 'AUTHORED_CATALOGS'

/**
 * English. Its catalog is the key-set authority every other catalog is measured
 * against, and it is the value a drifted manifest changes — so it is the one code that
 * must be bound for "the OTHER catalogs" to mean anything. Its absence means the parse
 * read something that is not the registry, which is worth a throw rather than a
 * plausible-looking short list.
 */
const ENGLISH = 'en'

/** Index of the closing quote of the string opening at `i`, or end of input. */
function endOfString(text, i) {
  const quote = text[i]
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue }
    if (text[j] === quote) return j
  }
  return text.length
}

/**
 * Remove line and block comments, leaving string literals intact.
 *
 * String awareness is what makes a key like `'x//y'` survive. Regex literals are NOT
 * tracked, so a `/…/` pattern containing a comment opener would corrupt the text — and
 * that is safe by construction here: corrupted text fails to parse as a balanced object
 * literal, which throws. The failure mode is loud, not a short list of codes.
 */
export function stripComments(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const pair = source.slice(i, i + 2)
    if (pair === '//') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (pair === '/*') {
      const end = source.indexOf('*/', i + 2)
      i = end < 0 ? source.length : end + 2
      out += ' ' // keep the tokens either side of the comment apart
      continue
    }
    if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const end = endOfString(source, i)
      out += source.slice(i, end + 1)
      i = end + 1
      continue
    }
    out += source[i]
    i++
  }
  return out
}

/**
 * The text between the registry's own braces.
 *
 * The opening brace is located after the `=`, not after the identifier: the declaration
 * carries a type annotation (`Record<string, { translation: … }>`) whose brace comes
 * first and would otherwise be mistaken for the object's.
 */
function registryBody(source) {
  const at = source.indexOf(REGISTRY)
  if (at < 0) throw new Error(`${REGISTRY} not found in ${I18N_INDEX}`)
  const assign = source.indexOf('=', at)
  if (assign < 0) throw new Error(`${REGISTRY} in ${I18N_INDEX} has no initializer`)
  const open = source.indexOf('{', assign)
  if (open < 0) throw new Error(`${REGISTRY} in ${I18N_INDEX} is not an object literal`)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '"' || ch === "'" || ch === '`') { i = endOfString(source, i); continue }
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error(`${REGISTRY} in ${I18N_INDEX} has unbalanced braces`)
}

/** Split an object body on its own commas, ignoring commas nested in values. */
function topLevelEntries(body) {
  const entries = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"' || ch === "'" || ch === '`') { i = endOfString(body, i); continue }
    if (ch === '{' || ch === '[' || ch === '(') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth--
    else if (ch === ',' && depth === 0) { entries.push(body.slice(start, i)); start = i + 1 }
  }
  entries.push(body.slice(start))
  return entries
}

/** The property name an object entry declares — quoted (`'zh-CN'`) or bare (`en`). */
const KEY = /^\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))\s*:/

function keyOf(entry) {
  const m = KEY.exec(entry)
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

/**
 * The catalog codes an `index.ts` source binds, in registry order.
 *
 * Exported separately from the file read so the parse can be tested against sources
 * this repo does not contain — a commented-out entry, an absent registry — rather than
 * only against whatever `index.ts` happens to hold today.
 */
export function parseAuthoredCatalogCodes(source) {
  const codes = topLevelEntries(registryBody(stripComments(source)))
    .map(keyOf)
    .filter(code => code !== null)
  if (!codes.includes(ENGLISH)) {
    throw new Error(
      `${REGISTRY} parsed to [${codes.join(', ')}] with no '${ENGLISH}' catalog — `
      + 'that is a broken parse, not a registry without English',
    )
  }
  return codes
}

/** Every catalog the runtime binds, English included, in registry order. */
export function authoredCatalogCodes() {
  return parseAuthoredCatalogCodes(readFileSync(I18N_INDEX, 'utf8'))
}

/** The catalogs a changed English value has to be re-translated into. */
export function translatedCatalogCodes() {
  return authoredCatalogCodes().filter(code => code !== ENGLISH)
}

/**
 * The clause a gate prints when a changed English value invalidates translations.
 *
 * Lines, not one string: the words belong here where a test can read them, the
 * indentation belongs to whichever gate is printing. The catalogs are ENUMERATED
 * rather than counted, because a list is the only form of this sentence that stays
 * true on its own — the author also gets the exact set of files to open.
 */
export function retranslationHint(codes = translatedCatalogCodes()) {
  return [
    'A changed English value leaves every other catalog describing a string that no',
    `longer exists, and no gate reports that. Re-translate: ${codes.join(', ')}`,
  ]
}
