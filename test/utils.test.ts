import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getPath, INSTALL_DIR } from "../src/pkgman";
import { getAsBooleanFromENV, launchOptions } from "../src/utils";

function camoufoxInstalled(): boolean {
	return fs.existsSync(path.join(INSTALL_DIR.toString(), "version.json"));
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

	test("seeds only properties the installed browser still reads", async () => {
		const properties: { property: string; removed?: string }[] = JSON.parse(
			fs.readFileSync(getPath("properties.json"), "utf-8"),
		);
		const live = new Set(
			properties.filter((p) => p.removed === undefined).map((p) => p.property),
		);
		const { env } = await launchOptions({ headless: true });
		const keys = Object.keys(readConfig(env));
		for (const seed of ["fonts:spacing_seed", "audio:seed", "canvas:seed"]) {
			if (live.has(seed)) expect(keys).toContain(seed);
			else expect(keys).not.toContain(seed);
		}
	});

	test("skips seeds the installed browser does not support", async () => {
		const { env } = await launchOptions({
			headless: true,
			executable_path: legacyBrowserDir(),
		});
		const keys = Object.keys(readConfig(env));
		expect(keys).not.toContain("audio:seed");
		expect(keys).not.toContain("canvas:seed");
	});

	test("does not pin window.history.length", async () => {
		const { env } = await launchOptions({ headless: true });
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
			executable_path: legacyBrowserDir(),
			config: { "audio:seed": 123 },
		});
		expect(readConfig(env)["audio:seed"]).toBeUndefined();
	});
});
