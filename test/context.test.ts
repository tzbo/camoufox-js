import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	Camoufox,
	NewContext,
	generateContextFingerprint,
	getRandomPreset,
} from "../src";
import { INSTALL_DIR } from "../src/pkgman";

function camoufoxInstalled(): boolean {
	return fs.existsSync(path.join(INSTALL_DIR.toString(), "version.json"));
}

describe("generateContextFingerprint", () => {
	test("returns initScript and contextOptions", async () => {
		const fp = await generateContextFingerprint({ os: "macos" });
		expect(fp.initScript).toContain("setCanvasSeed");
		expect(fp.initScript).toContain("setNavigatorUserAgent");
		expect(fp.contextOptions.userAgent).toMatch(/Firefox/);
		expect(fp.contextOptions.userAgent).toMatch(/Mac OS/i);
		expect(fp.config["canvas:seed"]).toBeGreaterThan(0);
		expect(fp.config["audio:seed"]).toBeGreaterThan(0);
	});

	test("config_overrides apply before initScript", async () => {
		const fp = await generateContextFingerprint({
			os: "windows",
			configOverrides: { "fonts:spacing_seed": 0 },
		});
		expect(fp.config["fonts:spacing_seed"]).toBe(0);
		expect(fp.initScript).toContain("setFontSpacingSeed(0)");
	});

	test("accepts snake_case aliases", async () => {
		const fp = await generateContextFingerprint({
			os: "linux",
			ff_version: "148",
			config_overrides: { "fonts:spacing_seed": 1 },
		});
		expect(fp.config["navigator.userAgent"]).toMatch(/Firefox\/148/);
		expect(fp.config["fonts:spacing_seed"]).toBe(1);
	});

	test("getRandomPreset returns a macos preset", () => {
		const preset = getRandomPreset("macos");
		expect(preset?.navigator?.userAgent).toMatch(/Mac OS/i);
	});

	test("two calls produce different seeds", async () => {
		const a = await generateContextFingerprint({ os: "linux" });
		const b = await generateContextFingerprint({ os: "linux" });
		expect(a.config["canvas:seed"]).not.toBe(b.config["canvas:seed"]);
		expect(a.initScript).not.toBe(b.initScript);
	});
});

describe.skipIf(!camoufoxInstalled())("NewContext", () => {
	test("two contexts on one browser have isolated fingerprints", async () => {
		const browser = await Camoufox({ headless: true, main_world_eval: true });
		try {
			const ctx1 = await NewContext(browser, { os: "windows" });
			const ctx2 = await NewContext(browser, { os: "macos" });
			const page1 = await ctx1.newPage();
			const page2 = await ctx2.newPage();
			const ua1 = await page1.evaluate(() => navigator.userAgent);
			const ua2 = await page2.evaluate(() => navigator.userAgent);
			expect(ua1).toMatch(/Windows/i);
			expect(ua2).toMatch(/Mac OS/i);
			expect(ua1).not.toBe(ua2);
			await ctx1.close();
			await ctx2.close();
		} finally {
			await browser.close();
		}
	}, 30e3);
});
