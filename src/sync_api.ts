import {
	type Browser,
	type BrowserContext,
	type BrowserContextOptions,
	type BrowserType,
	firefox,
} from "playwright-core";

import {
	generateContextFingerprint,
	type FingerprintPreset,
} from "./fingerprints.js";
import { getGeolocation } from "./locale.js";
import { ProxyHelper, publicIP } from "./ip.js";
import {
	attachNoViewportDefault,
	type LaunchOptions,
	launchOptions,
	spoofsWindowDimensions,
	syncAttachVD,
} from "./utils.js";
import { VirtualDisplay } from "./virtdisplay.js";

export async function Camoufox<
	UserDataDir extends string | undefined = undefined,
	ReturnType = UserDataDir extends string ? BrowserContext : Browser,
>(
	launch_options: LaunchOptions & { user_data_dir?: UserDataDir } = {},
): Promise<ReturnType> {
	const { headless, user_data_dir, ...launchOptions } = launch_options;
	return NewBrowser(
		firefox,
		headless,
		{},
		user_data_dir ?? false,
		false,
		launchOptions,
	);
}

export async function NewBrowser<
	UserDataDir extends string | false = false,
	ReturnType = UserDataDir extends string ? BrowserContext : Browser,
>(
	playwright: BrowserType<Browser>,
	headless: boolean | "virtual" = false,
	fromOptions: Record<string, any> = {},
	userDataDir: UserDataDir = false as UserDataDir,
	debug: boolean = false,
	launch_options: LaunchOptions = {},
): Promise<ReturnType> {
	let virtualDisplay: VirtualDisplay | null = null;

	// Normalize headless to boolean and prepare options for launchOptions function
	const normalizedHeadless: boolean =
		headless === "virtual" ? false : headless || false;

	if (headless === "virtual") {
		virtualDisplay = new VirtualDisplay(debug);
		launch_options.virtual_display = await virtualDisplay.get();
	}

	if (!fromOptions || Object.keys(fromOptions).length === 0) {
		fromOptions = await launchOptions({
			debug,
			...launch_options,
			headless: normalizedHeadless,
		});
	}

	const noViewportDefault = spoofsWindowDimensions(fromOptions);

	if (typeof userDataDir === "string") {
		if (noViewportDefault && !("viewport" in fromOptions)) {
			fromOptions = { ...fromOptions, viewport: null };
		}
		const context = await playwright.launchPersistentContext(
			userDataDir,
			fromOptions,
		);
		return syncAttachVD(context, virtualDisplay);
	}

	const browser = await playwright.launch(fromOptions);
	if (noViewportDefault) {
		attachNoViewportDefault(browser);
	}
	return syncAttachVD(browser, virtualDisplay);
}

export interface NewContextOptions extends BrowserContextOptions {
	preset?: FingerprintPreset;
	os?: string | string[];
	ff_version?: string;
	webrtc_ip?: string;
	timezone?: string;
	locale?: string;
	config_overrides?: Record<string, any>;
}

async function resolveProxyGeo(proxy: {
	server: string;
	username?: string;
	password?: string;
}): Promise<{ ip?: string; timezone?: string }> {
	try {
		const ip = await publicIP(ProxyHelper.asString(proxy));
		try {
			const geo = await getGeolocation(ip);
			return { ip, timezone: geo.timezone };
		} catch {
			return { ip };
		}
	} catch {
		return {};
	}
}

export async function NewContext(
	browser: Browser,
	options: NewContextOptions = {},
): Promise<BrowserContext> {
	const {
		preset,
		os,
		ff_version,
		webrtc_ip,
		timezone,
		locale,
		config_overrides,
		proxy,
		geolocation,
		...contextKwargs
	} = options;

	let webrtcIp = webrtc_ip;
	const extras: BrowserContextOptions = { ...contextKwargs };
	if (proxy && (!webrtcIp || !extras.timezoneId)) {
		const geo = await resolveProxyGeo(proxy);
		if (!webrtcIp) webrtcIp = geo.ip;
		if (!extras.timezoneId && geo.timezone) extras.timezoneId = geo.timezone;
	}

	const fp = await generateContextFingerprint({
		preset,
		os,
		ffVersion: ff_version,
		webrtcIp,
		timezone,
		locale,
		configOverrides: config_overrides,
	});

	const opts: BrowserContextOptions = {
		...fp.contextOptions,
		...extras,
	};
	if (proxy) opts.proxy = proxy;
	if (geolocation) {
		opts.geolocation = geolocation;
		opts.permissions ??= ["geolocation"];
	}

	const context = await browser.newContext(opts);
	await context.addInitScript(fp.initScript);
	return context;
}
