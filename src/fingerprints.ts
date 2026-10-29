import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import {
	type Fingerprint,
	FingerprintGenerator,
	type FingerprintGeneratorOptions,
	type ScreenFingerprint,
} from "fingerprint-generator";
import BROWSERFORGE_DATA from "./mappings/browserforge.config.js";
import FONTS from "./mappings/fonts.config.js";
import { sampleWebGL } from "./webgl/sample.js";

const currentDir =
	import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));

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
	mac: [
		"Helvetica Neue",
		"PingFang HK",
		"PingFang SC",
		"PingFang TC",
		"Hiragino Sans GB",
		"Songti SC",
	],
	win: [
		"Segoe UI",
		"Tahoma",
		"Cambria Math",
		"Nirmala UI",
		"Microsoft YaHei",
		"Microsoft YaHei UI",
		"SimSun",
		"NSimSun",
	],
	lin: [
		"Arimo",
		"Cousine",
		"Tinos",
		"Twemoji Mozilla",
		"Noto Sans SC",
		"Noto Sans TC",
	],
};

function randint(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rngFrom(seed?: number): () => number {
	if (seed == null) return Math.random;
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function stableStringify(value: unknown): string {
	if (value === undefined) return "null";
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

export function identitySalt(pinned?: unknown): bigint {
	if (pinned == null) return randomBytes(8).readBigUInt64BE(0);
	return createHash("sha256")
		.update(stableStringify(pinned))
		.digest()
		.readBigUInt64BE(0);
}

export function versionlessUa(userAgent: string): string {
	return userAgent.replace(/(rv:|Firefox\/)[0-9][0-9.]*/g, "$1");
}

export function identitySeed(
	config: Record<string, any>,
	salt: bigint | number = 0,
): number {
	const parts = [
		versionlessUa(String(config["navigator.userAgent"] ?? "")),
		String(config["navigator.platform"] ?? ""),
		String(config["screen.width"] ?? ""),
		String(config["screen.height"] ?? ""),
		String(config["navigator.hardwareConcurrency"] ?? ""),
		String(salt),
	];
	return crc32(parts.join("|")) >>> 0;
}

const APP_VERSION_DROPPED = new Set(["Win64", "x64", "Mobile", "Tablet"]);

export function appVersionFromUserAgent(userAgent: string): string | undefined {
	const block = /^Mozilla\/5\.0 \(([^)]*)\)/.exec(userAgent || "");
	const inner = block?.[1];
	if (!inner) return undefined;
	const kept: string[] = [];
	for (const part of inner.split(";")) {
		const token = part.trim();
		if (
			!token ||
			token.startsWith("rv:") ||
			APP_VERSION_DROPPED.has(token) ||
			token.startsWith("Linux ") ||
			token.startsWith("Intel Mac OS X")
		) {
			continue;
		}
		kept.push(token.startsWith("Windows") ? "Windows" : token);
	}
	return kept.length ? `5.0 (${kept.join("; ")})` : undefined;
}

export function dropAudioSeed(config: Record<string, any>): void {
	delete config["audio:seed"];
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

export function generateFontSubset(
	targetOs: "win" | "mac" | "lin",
	seed?: number,
): string[] {
	const rng = rngFrom(seed);
	const full = FONTS[targetOs] ?? FONTS.mac;
	const markers = MARKER_FONTS[targetOs];
	const essential = new Set(markers);
	const result = full.filter((f) => essential.has(f));
	const rest = full.filter((f) => !essential.has(f));
	const pct = 30 + Math.floor(rng() * 49);
	const count = Math.round((pct / 100) * rest.length);
	for (let i = rest.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
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
	salt?: bigint,
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
	if (screen.devicePixelRatio) {
		config["window.devicePixelRatio"] = screen.devicePixelRatio;
	}

	const webgl = preset.webgl ?? {};
	if (webgl.unmaskedVendor) config["webGl:vendor"] = webgl.unmaskedVendor;
	if (webgl.unmaskedRenderer) config["webGl:renderer"] = webgl.unmaskedRenderer;

	if (preset.timezone) config.timezone = preset.timezone;
	const derived = appVersionFromUserAgent(
		String(config["navigator.userAgent"] ?? ""),
	);
	if (derived) config["navigator.appVersion"] = derived;

	const osName = platformToOs(String(nav.platform ?? ""));
	const drawSalt = salt ?? identitySalt();
	const seed = identitySeed(config, drawSalt);
	try {
		config.fonts = generateFontSubset(osToKey(osName), seed);
	} catch {
		if (preset.fonts) config.fonts = [...preset.fonts];
	}
	try {
		config.voices = generateVoiceSubset(osToKey(osName), undefined, seed);
	} catch {
		if (preset.speechVoices) {
			config.voices = normalizePresetVoices(
				preset.speechVoices,
				osToKey(osName),
			);
		}
	}
	return config;
}

type PresetBundle = {
	presets?: Record<string, FingerprintPreset[]>;
};

let presetsCache: PresetBundle | null = null;

export function loadPresets(): PresetBundle | null {
	if (presetsCache) return presetsCache;
	const file = path.join(currentDir, "data-files", "fingerprint-presets.json");
	if (!existsSync(file)) return null;
	presetsCache = JSON.parse(readFileSync(file, "utf-8"));
	return presetsCache;
}

export function getRandomPreset(
	os?: string | string[],
	_ffVersion?: string,
): FingerprintPreset | undefined {
	const bundle = loadPresets();
	if (!bundle?.presets) return undefined;
	const keys = os
		? (Array.isArray(os) ? os : [os]).map((o) =>
				o === "win"
					? "windows"
					: o === "mac"
						? "macos"
						: o === "lin"
							? "linux"
							: o,
			)
		: ["macos", "windows", "linux"];
	const candidates: FingerprintPreset[] = [];
	for (const key of keys) {
		candidates.push(...(bundle.presets[key] ?? []));
	}
	if (candidates.length === 0) return undefined;
	return candidates[randint(0, candidates.length - 1)];
}

const ESSENTIAL_VOICES_MACOS = [
	"Samantha",
	"Alex",
	"Fred",
	"Victoria",
	"Karen",
	"Daniel",
];

const VOICE_URI_PREFIX = {
	mac: "urn:moz-tts:osx:",
	win: "urn:moz-tts:sapi:",
	lin: "urn:moz-tts:speechd:",
};

function voiceUriSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ".")
		.replace(/^\.|\.$/g, "");
}

function voiceUri(
	osKey: "win" | "mac" | "lin",
	name: string,
	lang: string,
): string {
	if (osKey === "lin") {
		const escaped = [...name]
			.map((ch) => {
				if (ch === " ") return "%20";
				if (ch.charCodeAt(0) <= 0x7f) return ch;
				return [...new TextEncoder().encode(ch)]
					.map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
					.join("");
			})
			.join("");
		return `${VOICE_URI_PREFIX.lin}${escaped}?${lang}`;
	}
	return `${VOICE_URI_PREFIX[osKey]}${voiceUriSlug(name)}`;
}

function parseVoiceEntry(
	entry: string,
	osKey: "win" | "mac" | "lin",
): { name: string; lang: string; type: string } | null {
	const last = entry.lastIndexOf(":");
	if (last < 0) return null;
	const vtype = entry.slice(last + 1);
	const before = entry.slice(0, last);
	const langsep = before.lastIndexOf(":");
	if (langsep < 0) return null;
	return {
		name: before.slice(0, langsep),
		lang: before.slice(langsep + 1),
		type: vtype,
	};
}

export function generateVoiceSubset(
	targetOs: "win" | "mac" | "lin",
	locale?: string,
	seed?: number,
): any[] {
	const file = path.join(currentDir, "data-files", "voices.json");
	if (!existsSync(file)) return [];
	const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<
		string,
		string[]
	>;
	const full = (raw[targetOs] ?? [])
		.map((e) => parseVoiceEntry(e, targetOs))
		.filter((v): v is NonNullable<typeof v> => !!v);
	if (full.length === 0) return [];

	let selected = full;
	if (targetOs === "mac") {
		const rng = rngFrom(seed);
		const essential = new Set(ESSENTIAL_VOICES_MACOS);
		const result = full.filter((v) => essential.has(v.name));
		const rest = full.filter((v) => !essential.has(v.name));
		const pct = 40 + Math.floor(rng() * 41);
		const count = Math.round((pct / 100) * rest.length);
		for (let i = rest.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			const a = rest[i]!;
			rest[i] = rest[j]!;
			rest[j] = a;
		}
		result.push(...rest.slice(0, count));
		selected = result;
	}

	const voices = selected.map((v) => ({
		name: v.name,
		lang: v.lang,
		voiceUri: voiceUri(targetOs, v.name, v.lang),
		isDefault: false,
		isLocalService: v.type === "local",
	}));
	if (voices.length > 0) {
		const prefix = locale ? locale.split("-")[0]!.toLowerCase() : "en";
		let idx = locale
			? voices.findIndex((v) => v.lang.toLowerCase() === locale.toLowerCase())
			: -1;
		if (idx < 0) {
			idx = voices.findIndex(
				(v) => v.lang.split("-")[0]!.toLowerCase() === prefix,
			);
		}
		voices[idx < 0 ? 0 : idx]!.isDefault = true;
	}
	return voices;
}

function normalizePresetVoices(
	voices: any[],
	targetOs: "win" | "mac" | "lin",
): any[] {
	const result: any[] = [];
	for (const entry of voices) {
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			result.push(entry);
			continue;
		}
		if (typeof entry !== "string") continue;
		const parsed = parseVoiceEntry(entry, targetOs);
		if (!parsed) continue;
		result.push({
			name: parsed.name,
			lang: parsed.lang,
			voiceUri: voiceUri(targetOs, parsed.name, parsed.lang),
			isDefault: false,
			isLocalService: parsed.type === "local",
		});
	}
	if (result.length > 0 && !result.some((v) => v.isDefault)) {
		result[0].isDefault = true;
	}
	return result;
}

export function clampScreenToDisplay(
	config: Record<string, any>,
	maxWidth?: number,
	maxHeight?: number,
): void {
	for (const [axis, cap] of [
		["width", maxWidth],
		["height", maxHeight],
	] as const) {
		const screen = config[`screen.${axis}`];
		if (!(screen && cap) || screen <= cap) continue;
		const availKey =
			axis === "width" ? "screen.availWidth" : "screen.availHeight";
		const avail = config[availKey];
		config[`screen.${axis}`] = cap;
		if (avail) {
			config[availKey] = Math.max(1, cap - Math.max(0, screen - avail));
		}
	}
}

const MEDIA_P_NO_MIC: Record<string, number> = { win: 0.08, mac: 0, lin: 0.2 };
const MEDIA_P_BUILTIN_CAM: Record<string, number> = {
	win: 0.78,
	mac: 0,
	lin: 0.45,
};

type MediaItem = {
	w?: number;
	mics?: string[];
	outs?: string[];
	cam?: string;
	mic?: string | null;
};

let mediaDevicesCache: Record<string, any> | null = null;

function loadMediaDevices(): Record<string, any> {
	if (mediaDevicesCache) return mediaDevicesCache;
	const file = path.join(currentDir, "data-files", "media-devices.json");
	const loaded = JSON.parse(readFileSync(file, "utf-8")) as Record<string, any>;
	mediaDevicesCache = loaded;
	return loaded;
}

function weightedChoice(rng: () => number, items: MediaItem[]): MediaItem {
	const total = items.reduce((sum, item) => sum + (item.w ?? 1), 0);
	let r = rng() * total;
	let picked = items[0];
	for (const item of items) {
		picked = item;
		r -= item.w ?? 1;
		if (r < 0) return item;
	}
	return picked ?? {};
}

export function drawMediaDevices(
	osKey: "win" | "mac" | "lin",
	seed?: number,
): Record<string, any> {
	const rng = rngFrom(seed);
	const cat = loadMediaDevices()[osKey] ?? loadMediaDevices().win;
	const mics: Array<[string, string]> = [];
	const outs: Array<[string, string]> = [];
	const cams: Array<[string, string]> = [];
	let n = 0;
	const group = () => `hw-${++n}`;
	const add = (item: MediaItem, grp: string) => {
		for (const mic of item.mics ?? []) mics.push([mic, grp]);
		for (const out of item.outs ?? []) outs.push([out, grp]);
		if (item.cam) cams.push([item.cam, group()]);
	};
	const card = weightedChoice(rng, cat.cards);
	const noMic = rng() < (MEDIA_P_NO_MIC[osKey] ?? 0);
	const cardGroup = group();
	add(noMic ? { ...card, mics: [] } : card, cardGroup);
	const pCam = MEDIA_P_BUILTIN_CAM[osKey] ?? 0;
	if (rng() < (noMic ? pCam * 0.3 : pCam)) {
		const builtin = (cat.cameras as MediaItem[]).filter((c) => !c.mic);
		const cam = builtin.length ? weightedChoice(rng, builtin).cam : undefined;
		if (cam) cams.push([cam, group()]);
	}
	if (rng() < (cat.p_headset ?? 0))
		add(weightedChoice(rng, cat.headsets), group());
	if (rng() < (cat.p_display ?? 0))
		add(weightedChoice(rng, cat.displays), group());
	if (rng() < (cat.p_extra_camera ?? 0)) {
		const external = (cat.cameras as MediaItem[]).filter((c) => c.mic);
		const cam = weightedChoice(rng, external.length ? external : cat.cameras);
		const grp = group();
		if (cam.cam) cams.push([cam.cam, grp]);
		if (cam.mic) mics.push([cam.mic, grp]);
	}
	if (cat.monitor_sources) {
		for (const [label, grp] of [...outs])
			mics.push([`Monitor of ${label}`, grp]);
	}
	return {
		"mediaDevices:enabled": true,
		"mediaDevices:micros": mics.length,
		"mediaDevices:webcams": cams.length,
		"mediaDevices:speakers": outs.length,
		"mediaDevices:microphoneLabels": mics.map(([label]) => label),
		"mediaDevices:microphoneGroups": mics.map(([, grp]) => grp),
		"mediaDevices:webcamLabels": cams.map(([label]) => label),
		"mediaDevices:webcamGroups": cams.map(([, grp]) => grp),
		"mediaDevices:speakerLabels": outs.map(([label]) => label),
		"mediaDevices:speakerGroups": outs.map(([, grp]) => grp),
	};
}

export function applyConfigFixes(
	config: Record<string, any>,
	targetOs: "win" | "mac" | "lin",
	parts: {
		navigator?: boolean;
		screen?: boolean;
		media?: boolean;
		seed?: number;
	} = {},
): void {
	const {
		navigator: fixNav = true,
		screen: fixScreen = true,
		media: fixMedia = true,
	} = parts;
	if (!fixNav && !fixScreen && !fixMedia) return;
	if (fixNav && targetOs === "lin") {
		const ua = String(config["navigator.userAgent"] ?? "");
		let arch = "";
		if (ua.includes("Linux x86_64")) arch = "Linux x86_64";
		else if (ua.includes("Linux i686")) arch = "Linux i686";
		if (arch) {
			if (config["navigator.platform"] !== arch) {
				config["navigator.platform"] = arch;
			}
			if (config["navigator.oscpu"] !== arch) {
				config["navigator.oscpu"] = arch;
			}
		}
	}

	if (fixScreen) {
		const sw = config["screen.width"];
		const sh = config["screen.height"];
		const aw = config["screen.availWidth"];
		const ah = config["screen.availHeight"];
		if (sw && sh && aw === sw && ah === sh) {
			const taskbar = targetOs === "win" ? 40 : targetOs === "mac" ? 25 : 27;
			const newAvail = sh - taskbar;
			config["screen.availHeight"] = newAvail;
			const oh = config["window.outerHeight"];
			if (oh && oh > newAvail) {
				const ih = config["window.innerHeight"];
				const chrome = ih ? oh - ih : 0;
				config["window.outerHeight"] = newAvail;
				if (ih) config["window.innerHeight"] = newAvail - chrome;
			}
		}

		for (const axis of ["Width", "Height"] as const) {
			const dim = config[`screen.${axis.toLowerCase()}`];
			const availKey = `screen.avail${axis}`;
			const outerKey = `window.outer${axis}`;
			const innerKey = `window.inner${axis}`;
			let avail = config[availKey];
			if (dim && avail && avail > dim) {
				config[availKey] = dim;
				avail = dim;
			}
			const outerCap = avail ?? dim;
			const outer = config[outerKey];
			const inner = config[innerKey];
			if (outer && outerCap && outer > outerCap) {
				const chrome = inner ? Math.max(0, outer - inner) : 0;
				config[outerKey] = outerCap;
				if (inner) config[innerKey] = Math.max(1, outerCap - chrome);
			}
			const outerClamped = config[outerKey] ?? outer;
			const innerNow = config[innerKey];
			if (innerNow && outerClamped && innerNow > outerClamped) {
				config[innerKey] = outerClamped;
			}
		}

		for (const [axis, posKey] of [
			["Width", "window.screenX"],
			["Height", "window.screenY"],
		] as const) {
			const dim = config[`screen.${axis.toLowerCase()}`];
			const outer = config[`window.outer${axis}`];
			const pos = config[posKey];
			if (pos === undefined || !(dim && outer)) continue;
			config[posKey] = Math.max(0, Math.min(pos, dim - outer));
		}
	}

	if (
		fixMedia &&
		!Object.keys(config).some((k) => k.startsWith("mediaDevices:"))
	) {
		Object.assign(
			config,
			drawMediaDevices(
				targetOs,
				parts.seed ?? identitySeed(config, identitySalt()),
			),
		);
	}
}

function buildInitScript(values: Record<string, any>): string {
	const lines = ["(function(v) {", "  var w = window;"];
	const setters: Array<[string, string]> = [
		["fontSpacingSeed", "setFontSpacingSeed"],
		["navigatorPlatform", "setNavigatorPlatform"],
		["navigatorOscpu", "setNavigatorOscpu"],
		["navigatorUserAgent", "setNavigatorUserAgent"],
		["navigatorAppVersion", "setNavigatorAppVersion"],
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
	fingerprint?: Fingerprint;
	os?: string | string[];
	ffVersion?: string;
	ff_version?: string;
	webrtcIp?: string;
	webrtc_ip?: string;
	timezone?: string;
	locale?: string;
	screen?: FingerprintGeneratorOptions["screen"];
	configOverrides?: Record<string, any>;
	config_overrides?: Record<string, any>;
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
	const ffVersion = options.ffVersion ?? options.ff_version;
	const webrtcIp = options.webrtcIp ?? options.webrtc_ip;
	const timezone = options.timezone;
	const locale = options.locale;
	const configOverrides = options.configOverrides ?? options.config_overrides;
	let { preset, os } = options;

	let config: Record<string, any>;
	let nav: Record<string, any>;
	let screen: Record<string, any>;
	let webgl: Record<string, any>;

	let salt: bigint;
	if (preset) {
		salt = identitySalt(preset);
		config = fromPreset(preset, ffVersion, salt);
		nav = preset.navigator ?? {};
		screen = preset.screen ?? {};
		webgl = preset.webgl ?? {};
	} else {
		const operatingSystems = os
			? ((Array.isArray(os)
					? os
					: [os]) as FingerprintGeneratorOptions["operatingSystems"])
			: undefined;
		const genOpts: Partial<FingerprintGeneratorOptions> = {};
		if (operatingSystems) genOpts.operatingSystems = operatingSystems;
		if (options.screen) genOpts.screen = options.screen;
		const fp =
			options.fingerprint ??
			generateFingerprint(
				undefined,
				Object.keys(genOpts).length ? genOpts : undefined,
			);
		salt = identitySalt(options.fingerprint ?? fp);
		config = fromBrowserforge(fp, ffVersion);
		dropAudioSeed(config);

		const plat = String(config["navigator.platform"] ?? "");
		const osName = platformToOs(plat);
		const seed = identitySeed(config, salt);
		if (!config.fonts) {
			try {
				config.fonts = generateFontSubset(osToKey(osName), seed);
			} catch {
				/* launch-level fonts remain */
			}
		}
		if (!config.voices) {
			try {
				config.voices = generateVoiceSubset(osToKey(osName), locale, seed);
			} catch {
				/* optional */
			}
		}
		if (!config["navigator.oscpu"]) {
			const oscpu = deriveOscpu(plat);
			if (oscpu) config["navigator.oscpu"] = oscpu;
		}
		const derived = appVersionFromUserAgent(
			String(config["navigator.userAgent"] ?? ""),
		);
		if (derived) config["navigator.appVersion"] = derived;
		if (!config["webGl:vendor"] || !config["webGl:renderer"]) {
			try {
				const targetOs = osToKey(typeof os === "string" ? os : osName);
				const webglFp = await sampleWebGL(targetOs, undefined, undefined, seed);
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
			devicePixelRatio:
				config["window.devicePixelRatio"] ?? config["screen.devicePixelRatio"],
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
	const targetOs = osToKey(
		platformToOs(String(config["navigator.platform"] ?? "")),
	);
	if (!config.voices) {
		try {
			config.voices = generateVoiceSubset(
				targetOs,
				locale,
				identitySeed(config, salt),
			);
		} catch {
			/* optional */
		}
	}
	applyConfigFixes(config, targetOs, { seed: identitySeed(config, salt) });
	dropAudioSeed(config);
	if (configOverrides) {
		dropAudioSeed(configOverrides);
		Object.assign(config, configOverrides);
	}

	const initValues: Record<string, any> = {
		fontSpacingSeed: config["fonts:spacing_seed"],
		navigatorPlatform: config["navigator.platform"] ?? nav.platform,
		navigatorAppVersion: config["navigator.appVersion"],
		navigatorOscpu: config["navigator.oscpu"],
		navigatorUserAgent: config["navigator.userAgent"],
		hardwareConcurrency:
			config["navigator.hardwareConcurrency"] ?? nav.hardwareConcurrency,
		webglVendor: webgl.unmaskedVendor ?? config["webGl:vendor"],
		webglRenderer: webgl.unmaskedRenderer ?? config["webGl:renderer"],
		screenWidth: config["screen.width"] ?? screen.width,
		screenHeight: config["screen.height"] ?? screen.height,
		screenColorDepth: config["screen.colorDepth"] ?? screen.colorDepth,
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
