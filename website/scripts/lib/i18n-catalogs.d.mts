/**
 * Types for the catalog-registry parser that the i18n gates and their tests share.
 *
 * The implementation is plain `.mjs` because the gates run under bare node with no
 * build step. Test code IS type-checked (`tsconfig.test.json`), so without a
 * declaration the import resolves to an implicit `any` and trips TS7016 — which is
 * a type error in the test, not in the gate.
 */

/** Remove line and block comments, leaving string literals intact. */
export function stripComments(source: string): string

/**
 * Catalog codes parsed out of an `AUTHORED_CATALOGS` source, in registry order.
 *
 * Throws when the parse yields no English catalog: that is a broken parse rather
 * than a registry without English.
 */
export function parseAuthoredCatalogCodes(source: string): string[]

/** Every catalog the runtime binds, English included, in registry order. */
export function authoredCatalogCodes(): string[]

/** The catalogs a changed English value has to be re-translated into. */
export function translatedCatalogCodes(): string[]

/**
 * The clause a gate prints when a changed English value invalidates translations.
 *
 * Lines rather than one string: the indentation belongs to the calling gate.
 */
export function retranslationHint(codes?: string[]): string[]
