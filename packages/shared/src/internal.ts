/*
 * Server-only shared code: the eSIM price rules and plan building (net price, markup, the owner's pricing rules) and the
 * mock supplier's packages. Not in the index, so none of it is bundled into the app; the Core API imports it from
 * '@mada/shared/internal', and the app's mock API (a mock build only) does too.
 */
export * from './schemas/esim-plans';
export * from './schemas/esim-pricing';
export { ESIM_FIXTURE_PACKAGES } from './schemas/esim-fixtures';
