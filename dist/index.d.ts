export { launchServer } from "./server.js";
export { Camoufox, NewBrowser, NewContext } from "./sync_api.js";
export type { NewContextOptions } from "./sync_api.js";
export { generateContextFingerprint, fromPreset, fromBrowserforge, generateFingerprint, getRandomPreset, loadPresets, applyConfigFixes, } from "./fingerprints.js";
export type { ContextFingerprint, ContextFingerprintOptions, FingerprintPreset, } from "./fingerprints.js";
export { type LaunchOptions, launchOptions } from "./utils.js";
export { DefaultAddons } from "./addons.js";
export type { Browser, BrowserContext, BrowserContextOptions, Page, Cookie, Response, } from "playwright-core";
