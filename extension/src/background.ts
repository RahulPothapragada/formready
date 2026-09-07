/**
 * No persistent work happens here. Its only job is to give the extension a
 * stable, discoverable target (a service worker) so tooling — and the CDP
 * verification script — can find this extension's runtime id without
 * scraping chrome://extensions.
 */
export {};
