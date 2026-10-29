import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { camoufoxPath, getPath } from "../src/pkgman";
import { getAsBooleanFromENV, launchOptions } from "../src/utils";

function camoufoxInstalled(): boolean {
	try {
		camoufoxPath(false);
		return true;
	} catch {
		return false;
	}
}

describe("getAsBooleanFromENV", () => {
	afterEach(() => {
		// Clean up env vars
		delete process.env.TEST_BOOL_VAR;
	});

	test("returns true for truthy env value", () => {
		process.env.TEST_BOOL_VAR = "1";
		expect(getAsBooleanFromENV("TEST_BOOL_VAR")).toBe(true);
	});

	test("returns true for non-empty string", () => {
		process.env.TEST_BOOL_VAR = "yes";
		expect(getAsBooleanFromENV("TEST_BOOL_VAR")).toBe(true);
	});

	test("returns false for '0'", () => {
		process.env.TEST_BOOL_VAR = "0";
		expect(getAsBooleanFromENV("TEST_BOOL_VAR")).toBe(false);
	});

	test("returns false for 'false'", () => {
		process.env.TEST_BOOL_VAR = "false";
		expect(getAsBooleanFromENV("TEST_BOOL_VAR")).toBe(false);
	});

	test("returns default value when env var not set", () => {
		expect(getAsBooleanFromENV("TEST_BOOL_VAR", true)).toBe(true);
		expect(getAsBooleanFromENV("TEST_BOOL_VAR", false)).toBe(false);
	});

	test("returns false when env var not set and no default", () => {
		expect(getAsBooleanFromENV("TEST_BOOL_VAR")).toBe(false);
	});
});

describe.skipIf(!camoufoxInstalled())("launchOptions seeding", () => {
	const readConfig = (env: Record<string, unknown>) =>
		JSON.parse(
			Object.keys(env)
				.filter((k) => k.startsWith("CAMOU_CONFIG_"))
				.sort()
				.map((k) => env[k])
				.join(""),
		);

	// Browsers older than Camoufox 2.0 have no audio:seed / canvas:seed property,
	// and validateConfig rejects anything missing from properties.json.
	const legacyBrowserDir = () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "camoufox-legacy-"));
		const properties = JSON.parse(
			fs.readFileSync(getPath("properties.json"), "utf-8"),
		).filter(
			(p: { property: string }) =>
				p.property !== "audio:seed" && p.property !== "canvas:seed",
		);
		fs.writeFileSync(
			path.join(dir, "properties.json"),
			JSON.stringify(properties),
		);
		return path.join(dir, "camoufox-bin");
	};

	test("does not send audio or canvas seeds", async () => {
		const { env } = await launchOptions({ headless: true, os: "linux" });
		const keys = Object.keys(readConfig(env));
		for (const seed of ["fonts:spacing_seed", "audio:seed", "canvas:seed"]) {
			expect(keys).not.toContain(seed);
		}
	});

	test("skips seeds the installed browser does not support", async () => {
		const { env } = await launchOptions({
			headless: true,
			os: "linux",
			executable_path: legacyBrowserDir(),
		});
		const keys = Object.keys(readConfig(env));
		expect(keys).not.toContain("audio:seed");
		expect(keys).not.toContain("canvas:seed");
	});

	test("does not pin window.history.length", async () => {
		const { env } = await launchOptions({ headless: true, os: "linux" });
		expect(readConfig(env)["window.history.length"]).toBeUndefined();
	});

	test("fingerprint_preset true uses a bundled preset", async () => {
		const { env } = await launchOptions({
			headless: true,
			os: "macos",
			fingerprint_preset: true,
		});
		const config = readConfig(env);
		expect(config["navigator.userAgent"]).toMatch(/Mac OS/i);
		expect(config["webGl:vendor"]).toBeTruthy();
	});

	test("drops an explicitly passed unsupported seed", async () => {
		const { env } = await launchOptions({
			headless: true,
			os: "linux",
			executable_path: legacyBrowserDir(),
			config: { "audio:seed": 123 },
		});
		expect(readConfig(env)["audio:seed"]).toBeUndefined();
	});
});

describe("launchOptions parity", () => {
	const readConfig = (env: Record<string, unknown>) =>
		JSON.parse(
			Object.keys(env)
				.filter((k) => k.startsWith("CAMOU_CONFIG_"))
				.sort()
				.map((k) => env[k])
				.join(""),
		);

	const mockBrowserBin = () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "camoufox-mock-"));
		const props = [
			{ property: "navigator.userAgent", type: "str" },
			{ property: "navigator.appVersion", type: "str" },
			{ property: "navigator.platform", type: "str" },
			{ property: "navigator.oscpu", type: "str" },
			{ property: "navigator.hardwareConcurrency", type: "uint" },
			{ property: "screen.width", type: "int" },
			{ property: "screen.height", type: "int" },
			{ property: "window.devicePixelRatio", type: "double" },
			{ property: "fonts", type: "array" },
			{ property: "voices", type: "array" },
			{ property: "voices:blockIfNotDefined", type: "bool" },
			{ property: "webGl:vendor", type: "str" },
			{ property: "webGl:renderer", type: "str" },
			{ property: "input:windowsKeyboard", type: "bool" },
			{ property: "mediaDevices:enabled", type: "bool" },
			{ property: "mediaDevices:micros", type: "uint" },
			{ property: "mediaDevices:webcams", type: "uint" },
			{ property: "mediaDevices:speakers", type: "uint" },
			{ property: "mediaDevices:microphoneLabels", type: "array" },
			{ property: "mediaDevices:microphoneGroups", type: "array" },
			{ property: "mediaDevices:webcamLabels", type: "array" },
			{ property: "mediaDevices:webcamGroups", type: "array" },
			{ property: "mediaDevices:speakerLabels", type: "array" },
			{ property: "mediaDevices:speakerGroups", type: "array" },
		];
		fs.writeFileSync(path.join(dir, "properties.json"), JSON.stringify(props));
		return path.join(dir, "camoufox-bin");
	};

	test("keeps draws stable across Firefox upgrades for a pinned preset", async () => {
		const executable_path = mockBrowserBin();
		const preset = {
			navigator: {
				userAgent:
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:146.0) Gecko/20100101 Firefox/146.0",
				platform: "MacIntel",
				hardwareConcurrency: 8,
			},
			screen: {
				width: 1440,
				height: 900,
				availWidth: 1440,
				availHeight: 875,
				colorDepth: 24,
				devicePixelRatio: 2,
			},
		};
		const a = await launchOptions({
			headless: true,
			os: "macos",
			executable_path,
			exclude_addons: ["UBO"],
			fingerprint_preset: preset,
			ff_version: 152,
		});
		const b = await launchOptions({
			headless: true,
			os: "macos",
			executable_path,
			exclude_addons: ["UBO"],
			fingerprint_preset: preset,
			ff_version: 158,
		});
		const cfgA = readConfig(a.env);
		const cfgB = readConfig(b.env);
		expect(cfgA.fonts).toEqual(cfgB.fonts);
		expect(cfgA.voices).toEqual(cfgB.voices);
		expect(cfgA["webGl:renderer"]).toBe(cfgB["webGl:renderer"]);
		expect(cfgA["mediaDevices:microphoneLabels"]).toEqual(
			cfgB["mediaDevices:microphoneLabels"],
		);
		expect(cfgA["navigator.appVersion"]).toBe("5.0 (Macintosh)");
		expect(a.firefoxUserPrefs["layout.css.devPixelsPerPx"]).toBe("2");
	});

	test("writes toggle prefs, cross-OS Windows prefs, and drops audio:seed", async () => {
		const executable_path = mockBrowserBin();
		const { env, firefoxUserPrefs } = await launchOptions({
			headless: true,
			os: "windows",
			executable_path,
			exclude_addons: ["UBO"],
			ff_version: 158,
			config: { "audio:seed": 42 },
		});
		const cfg = readConfig(env);
		expect(cfg["audio:seed"]).toBeUndefined();
		expect(cfg["voices:blockIfNotDefined"]).toBe(true);
		expect(firefoxUserPrefs["permissions.default.image"]).toBe(1);
		expect(firefoxUserPrefs["media.peerconnection.enabled"]).toBe(true);
		expect(
			firefoxUserPrefs["browser.tabs.remote.useCrossOriginOpenerPolicy"],
		).toBe(true);
		expect(firefoxUserPrefs["dom.webgpu.enabled"]).toBe(true);
		expect(firefoxUserPrefs["gfx.blacklist.webgpu"]).toBe(4);
	});
});
