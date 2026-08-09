import { describe, expect, it } from 'vitest'

import {
  authoredCatalogCodes,
  parseAuthoredCatalogCodes,
  retranslationHint,
  translatedCatalogCodes,
} from '../../scripts/lib/i18n-catalogs.mjs'
import { AUTHORED_CATALOGS } from '../i18n'

/**
 * The gate-side view of the catalog registry.
 *
 * `scripts/lib/i18n-catalogs.mjs` parses `AUTHORED_CATALOGS` out of
 * `src/i18n/index.ts` because a plain-node gate cannot import that module (it needs a
 * bundler for `import.meta.env` and for extension-less JSON imports). This suite is
 * the other half of that arrangement: it imports the REAL constant through vitest's
 * TypeScript pipeline, so the parse can never quietly disagree with what ships.
 *
 * It matters because a wrong set fails in the direction that costs nothing to introduce
 * and everything to notice: name too few catalogs and the author updates too few, with
 * no gate left to report the difference. `check-app-manifest-sync.mjs` reads only
 * `en.json`, and `catalogParity.test.ts` proves a key is PRESENT, never that its value
 * is still a translation of the current English.
 */
describe('authored catalog registry', () => {
  /**
   * The load-bearing assertion. Order is part of it: the registry is ordered by
   * global speaker count and the remediation message reads better in that order than
   * in whatever order a parse happened to produce.
   */
  it('parses exactly the codes the runtime binds, in registry order', () => {
    expect(authoredCatalogCodes()).toEqual(Object.keys(AUTHORED_CATALOGS))
  })

  it('treats every authored catalog except English as one a translator must update', () => {
    expect(translatedCatalogCodes()).toEqual(
      Object.keys(AUTHORED_CATALOGS).filter(code => code !== 'en'),
    )
  })

  it('names every translated catalog in the remediation hint, and never English', () => {
    const hint = retranslationHint().join(' ')
    for (const code of translatedCatalogCodes()) {
      expect(hint, `hint does not name '${code}'`).toContain(code)
    }
    // Enumerated, not counted. The whole set appears verbatim, which is the property
    // a count cannot have: adding a language moves the message with no edit anywhere.
    expect(hint).toContain(translatedCatalogCodes().join(', '))
    // English is the value being CHANGED, not one to re-translate into. Listing it
    // would send the author back to the file they just edited.
    expect(hint).not.toMatch(/[:,]\s*en\s*(?:,|$)/)
  })

  /**
   * A regex over source text also matches source text inside a comment, which is the
   * unsoundness `check-app-manifest-sync.mjs`'s own header warns about: an entry
   * wrapped in `/* … *\/` reads as bound when the runtime no longer has it. Here that
   * mistake sends the author to translate a catalog nobody ships, so the parse strips
   * comments before it reads any key.
   */
  it('ignores a commented-out entry', () => {
    const source = [
      'const AUTHORED_CATALOGS: Record<string, Bundle> = {',
      '  en: { translation: en },',
      '  // fr: { translation: fr },',
      '  /* de: { translation: de }, */',
      "  'zh-CN': { translation: zhCN },",
      '}',
    ].join('\n')
    expect(parseAuthoredCatalogCodes(source)).toEqual(['en', 'zh-CN'])
  })

  it('does not mistake a comment marker inside a string for a comment', () => {
    const source = [
      'const AUTHORED_CATALOGS: Record<string, Bundle> = {',
      '  en: { translation: en },',
      "  'x//y': { translation: xy },",
      '}',
    ].join('\n')
    expect(parseAuthoredCatalogCodes(source)).toEqual(['en', 'x//y'])
  })

  /**
   * A gate that cannot answer must fail, not fall back to a number — the same rule
   * `i18n-check.mjs` applies to a script it could not run. A silent fallback here is
   * precisely how a stale count reappears.
   */
  it('throws when the registry cannot be read', () => {
    expect(() => parseAuthoredCatalogCodes('export const CATALOGS = {}')).toThrow(
      /AUTHORED_CATALOGS/,
    )
  })

  it('throws when the parse yields no English catalog', () => {
    const source = [
      'const AUTHORED_CATALOGS: Record<string, Bundle> = {',
      '  fr: { translation: fr },',
      '}',
    ].join('\n')
    expect(() => parseAuthoredCatalogCodes(source)).toThrow(/en/)
  })
})
