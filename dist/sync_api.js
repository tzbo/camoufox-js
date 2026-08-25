import { firefox, } from "playwright-core";
import { generateContextFingerprint, } from "./fingerprints.js";
import { getGeolocation } from "./locale.js";
import { ProxyHelper, publicIP } from "./ip.js";
import { attachNoViewportDefault, launchOptions, spoofsWindowDimensions, syncAttachVD, } from "./utils.js";
import { VirtualDisplay } from "./virtdisplay.js";
export async function Camoufox(launch_options = {}) {
    const { headless, user_data_dir, ...launchOptions } = launch_options;
    return NewBrowser(firefox, headless, {}, user_data_dir ?? false, false, launchOptions);
}
export async function NewBrowser(playwright, headless = false, fromOptions = {}, userDataDir = false, debug = false, launch_options = {}) {
    let virtualDisplay = null;
    // Normalize headless to boolean and prepare options for launchOptions function
    const normalizedHeadless = headless === "virtual" ? false : headless || false;
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
        const context = await playwright.launchPersistentContext(userDataDir, fromOptions);
        return syncAttachVD(context, virtualDisplay);
    }
    const browser = await playwright.launch(fromOptions);
    if (noViewportDefault) {
        attachNoViewportDefault(browser);
    }
    return syncAttachVD(browser, virtualDisplay);
}
async function resolveProxyGeo(proxy) {
    try {
        const ip = await publicIP(ProxyHelper.asString(proxy));
        try {
            const geo = await getGeolocation(ip);
            return { ip, timezone: geo.timezone };
        }
        catch {
            return { ip };
        }
    }
    catch {
        return {};
    }
}
export async function NewContext(browser, options = {}) {
    const { preset, os, ff_version, webrtc_ip, timezone, locale, config_overrides, proxy, geolocation, ...contextKwargs } = options;
    let webrtcIp = webrtc_ip;
    const extras = { ...contextKwargs };
    if (proxy && (!webrtcIp || !extras.timezoneId)) {
        const geo = await resolveProxyGeo(proxy);
        if (!webrtcIp)
            webrtcIp = geo.ip;
        if (!extras.timezoneId && geo.timezone)
            extras.timezoneId = geo.timezone;
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
    const opts = {
        ...fp.contextOptions,
        ...extras,
    };
    if (proxy)
        opts.proxy = proxy;
    if (geolocation) {
        opts.geolocation = geolocation;
        opts.permissions ??= ["geolocation"];
    }
    const context = await browser.newContext(opts);
    await context.addInitScript(fp.initScript);
    return context;
}
