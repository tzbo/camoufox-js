import {
	type Fingerprint,
	FingerprintGenerator,
	type FingerprintGeneratorOptions,
	type ScreenFingerprint,
} from "fingerprint-generator";
import BROWSERFORGE_DATA from "./mappings/browserforge.config.js";
import FONTS from "./mappings/fonts.config.js";
import { sampleWebGL } from "./webgl/sample.js";

export const SUPPORTED_OS = ["linux", "macos", "windows"] as const;

const FP_GENERATOR = new FingerprintGenerator({
	browsers: ["firefox"],
	operatingSystems: SUPPORTED_OS as any,
});

function randrange(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface ExtendedScreen extends ScreenFingerprint {
	screenY?: number;
}

function _castToProperties(
	camoufoxData: Record<string, any>,
	castEnum: Record<string, any>,
	bfDict: Record<string, any>,
	ffVersion?: string,
): void {
	for (let [key, data] of Object.entries(bfDict)) {
		if (!data) continue;
		const typeKey = castEnum[key];
		if (!typeKey) continue;
		if (typeof data === "object" && !Array.isArray(data)) {
			_castToProperties(camoufoxData, typeKey, data, ffVersion);
			continue;
		}
		if (typeKey.startsWith("screen.") && typeof data === "number" && data < 0) {
			data = 0;
		}
		if (ffVersion && typeof data === "string") {
			data = data.replaceAll(
				/(?<!\d)(1[0-9]{2})(\.0)(?!\d)/gi,
				`${ffVersion}$2`,
			);
		}
		camoufoxData[typeKey] = data;
	}
}

function handleScreenXY(
	camoufoxData: Record<string, any>,
	fpScreen: ScreenFingerprint,
): void {
	if ("window.screenY" in camoufoxData) return;
	const screenX = fpScreen.screenX;
	if (!screenX) {
		camoufoxData["window.screenX"] = 0;
		camoufoxData["window.screenY"] = 0;
		return;
	}
	if (screenX >= -50 && screenX <= 50) {
		camoufoxData["window.screenY"] = screenX;
		return;
	}
	const screenY = fpScreen.availHeight - fpScreen.outerHeight;
	if (screenY === 0) {
		camoufoxData["window.screenY"] = 0;
	} else if (screenY > 0) {
		camoufoxData["window.screenY"] = randrange(0, screenY);
	} else {
		camoufoxData["window.screenY"] = randrange(screenY, 0);
	}
}

export function fromBrowserforge(
	fingerprint: Fingerprint,
	ffVersion?: string,
): Record<string, any> {
	const camoufoxData: Record<string, any> = {};
	_castToProperties(
		camoufoxData,
		BROWSERFORGE_DATA,
		{ ...fingerprint },
		ffVersion,
	);
	handleScreenXY(camoufoxData, fingerprint.screen);
	return camoufoxData;
}

function handleWindowSize(
	fp: Fingerprint,
	outerWidth: number,
	outerHeight: number,
): void {
	const sc: ExtendedScreen = { ...fp.screen, screenY: undefined };
	sc.screenX += Math.floor((sc.width - outerWidth) / 2);
	sc.screenY = Math.floor((sc.height - outerHeight) / 2);
	if (sc.innerWidth) {
		sc.innerWidth = Math.max(outerWidth - sc.outerWidth + sc.innerWidth, 0);
	}
	if (sc.innerHeight) {
		sc.innerHeight = Math.max(outerHeight - sc.outerHeight + sc.innerHeight, 0);
	}
	sc.outerWidth = outerWidth;
	sc.outerHeight = outerHeight;
	fp.screen = sc;
}

export function generateFingerprint(
	window?: [number, number],
	config?: Partial<FingerprintGeneratorOptions>,
): Fingerprint {
	if (window) {
		const { fingerprint } = FP_GENERATOR.getFingerprint(config);
		handleWindowSize(fingerprint, window[0], window[1]);
		return fingerprint;
	}
	return FP_GENERATOR.getFingerprint(config).fingerprint;
}

const MARKER_FONTS: Record<"win" | "mac" | "lin", string[]> = {
	mac: ["Helvetica Neue", "PingFang HK", "PingFang SC", "PingFang TC"],
	win: ["Segoe UI", "Tahoma", "Cambria Math", "Nirmala UI"],
	lin: ["Arimo", "Cousine", "Tinos", "Twemoji Mozilla"],
};

function randint(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function platformToOs(platform: string): "macos" | "windows" | "linux" {
	if (platform === "Win32") return "windows";
	if (platform.includes("Linux") || platform.toLowerCase().includes("linux")) {
		return "linux";
	}
	return "macos";
}

function osToKey(osName: string): "win" | "mac" | "lin" {
	if (osName === "windows" || osName === "win") return "win";
	if (osName === "linux" || osName === "lin") return "lin";
	return "mac";
}

function generateFontSubset(targetOs: "win" | "mac" | "lin"): string[] {
	const full = FONTS[targetOs] ?? FONTS.mac;
	const markers = MARKER_FONTS[targetOs];
	const essential = new Set(markers);
	const result = full.filter((f) => essential.has(f));
	const rest = full.filter((f) => !essential.has(f));
	const pct = 30 + Math.floor(Math.random() * 49);
	const count = Math.round((pct / 100) * rest.length);
	for (let i = rest.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const a = rest[i]!;
		rest[i] = rest[j]!;
		rest[j] = a;
	}
	result.push(...rest.slice(0, count));
	for (const m of markers) {
		if (!result.includes(m)) result.push(m);
	}
	return result;
}

function deriveOscpu(platform: string): string | undefined {
	if (platform === "MacIntel") return "Intel Mac OS X 10.15";
	if (platform === "Win32") return "Windows NT 10.0; Win64; x64";
	if (platform.includes("Linux") || platform.toLowerCase().includes("linux")) {
		return "Linux x86_64";
	}
	return undefined;
}

export interface FingerprintPreset {
	navigator?: Record<string, any>;
	screen?: Record<string, any>;
	webgl?: Record<string, any>;
	timezone?: string;
	fonts?: string[];
	speechVoices?: any[];
}

export function fromPreset(
	preset: FingerprintPreset,
	ffVersion?: string,
): Record<string, any> {
	const config: Record<string, any> = {};
	const nav = preset.navigator ?? {};
	if (nav.userAgent) {
		let ua = String(nav.userAgent);
		if (ffVersion) {
			ua = ua.replace(/Firefox\/\d+\.0/, `Firefox/${ffVersion}.0`);
			ua = ua.replace(/rv:\d+\.0/, `rv:${ffVersion}.0`);
		}
		config["navigator.userAgent"] = ua;
	}
	if (nav.platform) config["navigator.platform"] = nav.platform;
	if (nav.hardwareConcurrency) {
		config["navigator.hardwareConcurrency"] = nav.hardwareConcurrency;
	}
	if (nav.oscpu) {
		config["navigator.oscpu"] = nav.oscpu;
	} else if (nav.platform) {
		const oscpu = deriveOscpu(String(nav.platform));
		if (oscpu) config["navigator.oscpu"] = oscpu;
	}
	if ("maxTouchPoints" in nav) {
		config["navigator.maxTouchPoints"] = nav.maxTouchPoints;
	}

	const screen = preset.screen ?? {};
	if (screen.width) config["screen.width"] = screen.width;
	if (screen.height) config["screen.height"] = screen.height;
	if (screen.colorDepth) {
		config["screen.colorDepth"] = screen.colorDepth;
		config["screen.pixelDepth"] = screen.colorDepth;
	}
	if (screen.availWidth) config["screen.availWidth"] = screen.availWidth;
	if (screen.availHeight) config["screen.availHeight"] = screen.availHeight;

	const webgl = preset.webgl ?? {};
	if (webgl.unmaskedVendor) config["webGl:vendor"] = webgl.unmaskedVendor;
	if (webgl.unmaskedRenderer) config["webGl:renderer"] = webgl.unmaskedRenderer;

	config["fonts:spacing_seed"] = randint(1, 4_294_967_295);
	config["audio:seed"] = randint(1, 4_294_967_295);
	config["canvas:seed"] = randint(1, 4_294_967_295);
	if (preset.timezone) config.timezone = preset.timezone;

	const osName = platformToOs(String(nav.platform ?? ""));
	try {
		config.fonts = generateFontSubset(osToKey(osName));
	} catch {
		if (preset.fonts) config.fonts = [...preset.fonts];
	}
	return config;
}

function buildInitScript(values: Record<string, any>): string {
	const lines = ["(function(v) {", "  var w = window;"];
	const setters: Array<[string, string]> = [
		["fontSpacingSeed", "setFontSpacingSeed"],
		["audioFingerprintSeed", "setAudioFingerprintSeed"],
		["canvasSeed", "setCanvasSeed"],
		["navigatorPlatform", "setNavigatorPlatform"],
		["navigatorOscpu", "setNavigatorOscpu"],
		["navigatorUserAgent", "setNavigatorUserAgent"],
		["hardwareConcurrency", "setNavigatorHardwareConcurrency"],
		["webglVendor", "setWebGLVendor"],
		["webglRenderer", "setWebGLRenderer"],
	];
	for (const [key, fn] of setters) {
		const val = values[key];
		if (val !== undefined && val !== null) {
			lines.push(
				`  if (typeof w.${fn} === "function") w.${fn}(${JSON.stringify(val)});`,
			);
		}
	}
	const sw = values.screenWidth;
	const sh = values.screenHeight;
	if (sw && sh) {
		lines.push(
			`  if (typeof w.setScreenDimensions === "function") w.setScreenDimensions(${sw}, ${sh});`,
		);
		if (values.screenColorDepth) {
			lines.push(
				`  if (typeof w.setScreenColorDepth === "function") w.setScreenColorDepth(${values.screenColorDepth});`,
			);
		}
	}
	if (values.timezone) {
		lines.push(
			`  if (typeof w.setTimezone === "function") w.setTimezone(${JSON.stringify(values.timezone)});`,
		);
	}
	if (values.webrtcIP) {
		lines.push(
			`  if (typeof w.setWebRTCIPv4 === "function") w.setWebRTCIPv4(${JSON.stringify(values.webrtcIP)});`,
		);
	} else {
		lines.push(
			'  if (typeof w.setWebRTCIPv4 === "function") w.setWebRTCIPv4("");',
		);
	}
	if (Array.isArray(values.fontList) && values.fontList.length > 0) {
		lines.push(
			`  if (typeof w.setFontList === "function") w.setFontList(${JSON.stringify(values.fontList.join(","))});`,
		);
	}
	if (Array.isArray(values.speechVoices) && values.speechVoices.length > 0) {
		const names = values.speechVoices.map((v: any) =>
			typeof v === "object" && v ? v.name : v,
		);
		lines.push(
			`  if (typeof w.setSpeechVoices === "function") w.setSpeechVoices(${JSON.stringify(names.join(","))});`,
		);
	}
	lines.push("})();");
	return lines.join("\n");
}

export interface ContextFingerprintOptions {
	preset?: FingerprintPreset;
	os?: string | string[];
	ffVersion?: string;
	webrtcIp?: string;
	timezone?: string;
	locale?: string;
	configOverrides?: Record<string, any>;
}

export interface ContextFingerprint {
	initScript: string;
	contextOptions: Record<string, any>;
	config: Record<string, any>;
	preset?: FingerprintPreset;
}

export async function generateContextFingerprint(
	options: ContextFingerprintOptions = {},
): Promise<ContextFingerprint> {
	const {
		ffVersion,
		webrtcIp,
		timezone,
		locale,
		configOverrides,
	} = options;
	let { preset, os } = options;

	let config: Record<string, any>;
	let nav: Record<string, any>;
	let screen: Record<string, any>;
	let webgl: Record<string, any>;

	if (preset) {
		config = fromPreset(preset, ffVersion);
		nav = preset.navigator ?? {};
		screen = preset.screen ?? {};
		webgl = preset.webgl ?? {};
	} else {
		const operatingSystems = os
			? ((Array.isArray(os) ? os : [os]) as FingerprintGeneratorOptions["operatingSystems"])
			: undefined;
		const fp = generateFingerprint(
			undefined,
			operatingSystems ? { operatingSystems } : undefined,
		);
		config = fromBrowserforge(fp, ffVersion);
		config["fonts:spacing_seed"] ??= randint(1, 4_294_967_295);
		config["audio:seed"] ??= randint(1, 4_294_967_295);
		config["canvas:seed"] ??= randint(1, 4_294_967_295);

		const plat = String(config["navigator.platform"] ?? "");
		const osName = platformToOs(plat);
		if (!config.fonts) {
			try {
				config.fonts = generateFontSubset(osToKey(osName));
			} catch {
				/* launch-level fonts remain */
			}
		}
		if (!config["navigator.oscpu"]) {
			const oscpu = deriveOscpu(plat);
			if (oscpu) config["navigator.oscpu"] = oscpu;
		}
		if (!config["webGl:vendor"] || !config["webGl:renderer"]) {
			try {
				const targetOs = osToKey(
					typeof os === "string" ? os : osName,
				);
				const webglFp = await sampleWebGL(targetOs);
				const { webGl2Enabled: _webGl2Enabled, ...webGlConfig } =
					webglFp as Record<string, any>;
				Object.assign(config, webGlConfig);
			} catch {
				/* keep BrowserForge / launch defaults */
			}
		}
		nav = {
			platform: config["navigator.platform"],
			hardwareConcurrency: config["navigator.hardwareConcurrency"],
			userAgent: config["navigator.userAgent"],
		};
		screen = {
			width: config["screen.width"],
			height: config["screen.height"],
			colorDepth: config["screen.colorDepth"],
			devicePixelRatio: config["screen.devicePixelRatio"],
		};
		webgl = {
			unmaskedVendor: config["webGl:vendor"],
			unmaskedRenderer: config["webGl:renderer"],
		};
		preset = { navigator: nav, screen, webgl };
	}

	if (timezone) config.timezone = timezone;
	if (locale) {
		config["navigator.language"] = locale;
		const parts = locale.split("-");
		config["locale:language"] = parts[0];
		if (parts[1]) config["locale:region"] = parts[1];
	}
	if (configOverrides) Object.assign(config, configOverrides);

	const initValues: Record<string, any> = {
		fontSpacingSeed: config["fonts:spacing_seed"],
		audioFingerprintSeed: config["audio:seed"],
		canvasSeed: config["canvas:seed"],
		navigatorPlatform: nav.platform,
		navigatorOscpu: config["navigator.oscpu"],
		navigatorUserAgent: config["navigator.userAgent"],
		hardwareConcurrency:
			nav.hardwareConcurrency ?? config["navigator.hardwareConcurrency"],
		webglVendor: webgl.unmaskedVendor ?? config["webGl:vendor"],
		webglRenderer: webgl.unmaskedRenderer ?? config["webGl:renderer"],
		screenWidth: screen.width,
		screenHeight: screen.height,
		screenColorDepth: screen.colorDepth,
		timezone:
			typeof preset?.timezone === "string" ? preset.timezone : config.timezone,
		fontList: config.fonts,
		speechVoices: config.voices,
		webrtcIP: webrtcIp || "",
	};

	const contextOptions: Record<string, any> = {};
	const ua = config["navigator.userAgent"];
	if (ua) contextOptions.userAgent = ua;
	if (screen.width && screen.height) {
		contextOptions.viewport = {
			width: screen.width,
			height: Math.max(screen.height - 28, 600),
		};
	}
	if (screen.devicePixelRatio) {
		contextOptions.deviceScaleFactor = screen.devicePixelRatio;
	}
	const tz = config.timezone ?? preset?.timezone;
	if (tz) contextOptions.timezoneId = tz;
	if (config["navigator.language"]) {
		contextOptions.locale = config["navigator.language"];
	}

	return {
		initScript: buildInitScript(initValues),
		contextOptions,
		config,
		preset,
	};
}
