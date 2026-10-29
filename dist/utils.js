// from browserforge.fingerprints import Fingerprint, Screen
// from screeninfo import get_monitors
// from ua_parser import user_agent_parser
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { UAParser } from "ua-parser-js";
import { addDefaultAddons, confirmPaths, } from "./addons.js";
import { InvalidOS, InvalidPropertyType, NonFirefoxFingerprint, } from "./exceptions.js";
import { applyConfigFixes, appVersionFromUserAgent, clampScreenToDisplay, dropAudioSeed, fromBrowserforge, fromPreset, generateFingerprint, generateFontSubset, generateVoiceSubset, getRandomPreset, identitySalt, identitySeed, SUPPORTED_OS, } from "./fingerprints.js";
import { publicIP, validIPv4, validIPv6 } from "./ip.js";
import { geoipAllowed, getGeolocation, handleLocales } from "./locale.js";
import FONTS from "./mappings/fonts.config.js";
import { ensureCamoufoxInstalled, getPath, installedVerStr, launchPath, OS_NAME, } from "./pkgman.js";
import { LeakWarning } from "./warnings.js";
import { sampleWebGL } from "./webgl/sample.js";
// Camoufox preferences to cache previous pages and requests
const WINDOWS_11_MARKER_FONTS = new Set([
    "Sans Serif Collection",
    "Segoe Fluent Icons",
    "Segoe UI Variable",
    "Segoe UI Variable Display",
    "Segoe UI Variable Small",
    "Segoe UI Variable Text",
]);
const WINDOWS_BEHAVIOUR_PREFS = {
    "layout.word_select.eat_space_to_next_word": true,
    "general.autoScroll": true,
    "middlemouse.paste": false,
    "middlemouse.scrollbarPosition": false,
    "full-screen-api.transition-duration.enter": "200 200",
    "full-screen-api.transition-duration.leave": "200 200",
    "ui.scrollToClick": 0,
    "slider.snapMultiplier": 6,
    "layout.scrollbars.click_and_hold_track.continue_to_end": false,
};
const CANVAS_PLACEHOLDER_TARGETS = [
    "+CanvasImageExtractionPrompt",
    "+CanvasExtractionBeforeUserInputIsBlocked",
    "+CanvasExtractionFromThirdPartiesIsBlocked",
];
const BASELINE_OVERRIDES_PREF = "privacy.baselineFingerprintingProtection.overrides";
const WEBGPU_BLOCKLIST_PREF = "gfx.blacklist.webgpu";
const QUOTA_FIXED_LIMIT_PREF = "dom.quotaManager.temporaryStorage.fixedLimit";
const CACHE_PREFS = {
    "browser.sessionhistory.max_entries": 10,
    "browser.sessionhistory.max_total_viewers": -1,
    "browser.cache.memory.enable": true,
    "browser.cache.disk_cache_ssl": true,
    "browser.cache.disk.smart_size.enabled": true,
};
function getEnvVars(configMap, userAgentOS) {
    const envVars = {};
    let updatedConfigData;
    try {
        updatedConfigData = new TextEncoder().encode(JSON.stringify(configMap));
    }
    catch (e) {
        console.error(`Error updating config: ${e}`);
        process.exit(1);
    }
    const chunkSize = OS_NAME === "win" ? 2047 : 32767;
    const configStr = new TextDecoder().decode(updatedConfigData);
    for (let i = 0; i < configStr.length; i += chunkSize) {
        const chunk = configStr.slice(i, i + chunkSize);
        const envName = `CAMOU_CONFIG_${Math.floor(i / chunkSize) + 1}`;
        try {
            envVars[envName] = chunk;
        }
        catch (e) {
            console.error(`Error setting ${envName}: ${e}`);
            process.exit(1);
        }
    }
    if (OS_NAME === "lin") {
        const fontconfigPath = getPath(path.join("fontconfig", userAgentOS));
        envVars.FONTCONFIG_PATH = fontconfigPath;
    }
    return envVars;
}
export function getAsBooleanFromENV(name, defaultValue) {
    const value = process.env[name];
    if (value === "false" || value === "0")
        return false;
    if (value)
        return true;
    return !!defaultValue;
}
function loadProperties(filePath) {
    let propFile;
    filePath = filePath?.toString();
    if (filePath) {
        propFile = path.join(path.dirname(filePath), "properties.json");
    }
    else {
        propFile = getPath("properties.json");
    }
    const propData = readFileSync(propFile).toString();
    const propDict = JSON.parse(propData);
    return propDict.reduce((acc, prop) => {
        acc[prop.property] = prop;
        return acc;
    }, {});
}
function isLiveProperty(properties, key) {
    const entry = properties[key];
    return !!entry && entry.removed === undefined;
}
function validateConfig(configMap, properties) {
    for (const key of Object.keys(configMap)) {
        const entry = properties[key];
        if (!entry || entry.removed !== undefined) {
            delete configMap[key];
            continue;
        }
        if (!validateType(configMap[key], entry.type)) {
            throw new InvalidPropertyType(`Invalid type for property ${key}. Expected ${entry.type}, got ${typeof configMap[key]}`);
        }
    }
}
function validateType(value, expectedType) {
    switch (expectedType) {
        case "str":
            return typeof value === "string";
        case "int":
            return Number.isInteger(value);
        case "uint":
            return Number.isInteger(value) && value >= 0;
        case "double":
            return typeof value === "number";
        case "bool":
            return typeof value === "boolean";
        case "array":
            return Array.isArray(value);
        case "dict":
            return (typeof value === "object" && value !== null && !Array.isArray(value));
        default:
            return false;
    }
}
function getTargetOS(config) {
    if (config["navigator.userAgent"]) {
        return determineUAOS(config["navigator.userAgent"]);
    }
    return OS_NAME;
}
function determineUAOS(userAgent) {
    const parser = new UAParser(userAgent);
    const parsedUA = parser.getOS().name;
    if (!parsedUA) {
        throw new Error("Could not determine OS from user agent");
    }
    if (parsedUA.startsWith("macOS")) {
        return "mac";
    }
    if (parsedUA.startsWith("Windows")) {
        return "win";
    }
    return "lin";
}
function getScreenCons(headless) {
    if (headless === false) {
        return undefined;
    }
    // TODO - Implement getMonitors
    // try {
    //     const monitors = getMonitors();
    //     if (!monitors.length) {
    //         return undefined;
    //     }
    //     const monitor = monitors.reduce((prev, curr) => (prev.width * prev.height > curr.width * curr.height ? prev : curr));
    //     return { maxWidth: monitor.width, maxHeight: monitor.height };
    // } catch {
    //     return undefined;
    // }
    return undefined;
}
function updateFonts(config, targetOS) {
    const fonts = FONTS[targetOS];
    if (config.fonts) {
        config.fonts = Array.from(new Set([...fonts, ...config.fonts]));
    }
    else {
        config.fonts = fonts;
    }
}
function checkCustomFingerprint(fingerprint) {
    const parser = new UAParser(fingerprint.navigator.userAgent);
    const browserName = parser.getBrowser().name || "Non-Firefox";
    if (browserName !== "Firefox") {
        throw new NonFirefoxFingerprint(`"${browserName}" fingerprints are not supported in Camoufox. Using fingerprints from a browser other than Firefox WILL lead to detection. If this is intentional, pass i_know_what_im_doing=True.`);
    }
    LeakWarning.warn("custom_fingerprint", false);
}
function validateOS(os) {
    if (!os)
        return undefined;
    if (Array.isArray(os)) {
        os.every(validateOS);
        return [...os];
    }
    if (!SUPPORTED_OS.includes(os)) {
        throw new InvalidOS(`Camoufox does not support the OS: '${os}'`);
    }
    return [os];
}
function _cleanLocals(data) {
    delete data.playwright;
    delete data.persistentContext;
    return data;
}
function mergeInto(target, source) {
    Object.entries(source).forEach(([key, value]) => {
        if (!(key in target)) {
            target[key] = value;
        }
    });
}
function setInto(target, key, value) {
    if (!(key in target)) {
        target[key] = value;
    }
}
function isSoftwareRenderer(renderer) {
    return [
        "llvmpipe",
        "Microsoft Basic Render Driver",
        "SwiftShader",
        "Generic Renderer",
    ].some((name) => renderer.includes(name));
}
const LAUNCHER_ENV_PREFIXES = ["CAMOU_", "FONTCONFIG_FILE"];
const hostGpuCache = new Map();
function probeHostGpu(executablePath, headless, env = {}) {
    const hostEnvEntries = Object.entries(env)
        .filter(([k, v]) => v !== undefined &&
        !LAUNCHER_ENV_PREFIXES.some((prefix) => k.startsWith(prefix)))
        .map(([k, v]) => [k, String(v)])
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const key = JSON.stringify([executablePath, headless, hostEnvEntries]);
    let pending = hostGpuCache.get(key);
    if (!pending) {
        const hostEnv = Object.fromEntries(hostEnvEntries);
        pending = (async () => {
            try {
                const { firefox } = await import("playwright-core");
                const browser = await firefox.launch({
                    executablePath,
                    headless,
                    env: hostEnv,
                    firefoxUserPrefs: { "webgl.force-enabled": true },
                });
                try {
                    const page = await browser.newPage();
                    const gpu = await page.evaluate(() => {
                        const doc = globalThis.document;
                        const gl = doc.createElement("canvas").getContext("webgl");
                        const info = gl?.getExtension("WEBGL_debug_renderer_info");
                        if (!gl || !info)
                            return null;
                        return [
                            gl.getParameter(info.UNMASKED_VENDOR_WEBGL),
                            gl.getParameter(info.UNMASKED_RENDERER_WEBGL),
                        ];
                    });
                    if (Array.isArray(gpu) && gpu[0] && gpu[1]) {
                        return [String(gpu[0]), String(gpu[1])];
                    }
                }
                finally {
                    await browser.close();
                }
            }
            catch {
                return null;
            }
            return null;
        })();
        hostGpuCache.set(key, pending);
    }
    return pending;
}
function stockProfileDiskCapacityKb() {
    const home = homedir();
    const candidates = OS_NAME === "win"
        ? [
            process.env.APPDATA
                ? path.join(process.env.APPDATA, "Mozilla")
                : home,
            home,
        ]
        : OS_NAME === "mac"
            ? [path.join(home, "Library", "Application Support", "Firefox"), home]
            : [path.join(home, ".mozilla"), home];
    for (const candidate of candidates) {
        let probe = candidate;
        while (!existsSync(probe) && path.dirname(probe) !== probe) {
            probe = path.dirname(probe);
        }
        try {
            const st = statfsSync(probe);
            const total = Number(st.blocks) * Number(st.bsize);
            if (total > 0)
                return Math.min(Math.floor(total / 2 / 1024), 2 ** 31 - 1);
        }
        catch { }
    }
    return undefined;
}
function addCanvasPlaceholder(prefs) {
    const overrides = String(prefs[BASELINE_OVERRIDES_PREF] || "")
        .split(",")
        .filter(Boolean);
    prefs[BASELINE_OVERRIDES_PREF] = [
        ...overrides,
        ...CANVAS_PLACEHOLDER_TARGETS,
    ].join(",");
}
function isDomainSet(config, ...properties) {
    return properties.some((prop) => {
        if (prop.endsWith(".") || prop.endsWith(":")) {
            return Object.keys(config).some((key) => key.startsWith(prop));
        }
        return prop in config;
    });
}
function warnManualConfig(config) {
    if (isDomainSet(config, "navigator.language", "navigator.languages", "headers.Accept-Language", "locale:")) {
        LeakWarning.warn("locale", false);
    }
    if (isDomainSet(config, "geolocation:", "timezone")) {
        LeakWarning.warn("geolocation", false);
    }
    if (isDomainSet(config, "headers.User-Agent")) {
        LeakWarning.warn("header-ua", false);
    }
    if (isDomainSet(config, "navigator.")) {
        LeakWarning.warn("navigator", false);
    }
    if (isDomainSet(config, "screen.", "window.", "document.body.")) {
        LeakWarning.warn("viewport", false);
    }
}
const WINDOW_DIM_KEYS = [
    "window.outerWidth",
    "window.outerHeight",
    "window.innerWidth",
    "window.innerHeight",
    "document.body.clientWidth",
    "document.body.clientHeight",
];
/**
 * Whether the CAMOU_CONFIG in a set of launch options spoofs any window
 * dimension. The config is chunked across CAMOU_CONFIG_<n> env vars, so
 * reassemble it in index order before looking.
 */
export function spoofsWindowDimensions(fromOptions) {
    const env = fromOptions.env ?? {};
    const chunks = Object.entries(env)
        .filter(([key]) => key.startsWith("CAMOU_CONFIG_"))
        .map(([key, value]) => [Number(key.split("_").pop()), value])
        .sort(([a], [b]) => a - b);
    if (chunks.length === 0) {
        return false;
    }
    const blob = chunks.map(([, value]) => value).join("");
    return WINDOW_DIM_KEYS.some((key) => blob.includes(key));
}
/**
 * Defaults newPage()/newContext() to `viewport: null`.
 *
 * Playwright applies a 1280x720 viewport by default, which makes Juggler ask
 * the content window to become 1280x720. When Camoufox is pinning the window to
 * a spoofed size, that request can never be satisfied, so the page reports the
 * Playwright viewport instead of the spoofed dimensions (and a second
 * newPage() can hang - daijro/camoufox#666).
 *
 * Without a viewport, Juggler measures the window instead of resizing it.
 * An explicit viewport from the caller always wins.
 */
export function attachNoViewportDefault(target) {
    for (const name of ["newPage", "newContext"]) {
        const original = target[name];
        if (typeof original !== "function") {
            continue;
        }
        target[name] = (options, ...rest) => original.call(target, options && "viewport" in options
            ? options
            : { ...options, viewport: null }, ...rest);
    }
    return target;
}
async function _asyncAttachVD(browser, virtualDisplay) {
    if (!virtualDisplay) {
        return browser;
    }
    const originalClose = browser.close.bind(browser);
    browser.close = async (...args) => {
        try {
            return await originalClose(...args);
        }
        finally {
            if (virtualDisplay) {
                virtualDisplay.kill();
            }
        }
    };
    browser._virtualDisplay = virtualDisplay;
    return browser;
}
export function syncAttachVD(browser, virtualDisplay) {
    /**
     * Attaches the virtual display to the sync browser cleanup
     */
    if (!virtualDisplay) {
        // Skip if no virtual display is provided
        return browser;
    }
    const originalClose = browser.close.bind(browser);
    browser.close = async (...args) => {
        try {
            return await originalClose(...args);
        }
        finally {
            if (virtualDisplay) {
                virtualDisplay.kill();
            }
        }
    };
    browser._virtualDisplay = virtualDisplay;
    return browser;
}
/**
 * Convert a Playwright proxy string to a URL object.
 *
 * Implementation from https://github.com/microsoft/playwright/blob/3873b72ac1441ca691f7594f0ed705bd84518f93/packages/playwright-core/src/server/browserContext.ts#L737-L747
 */
function getProxyUrl(proxy) {
    if (!proxy)
        return null;
    if (typeof proxy === "string") {
        return new URL(proxy);
    }
    const { server, username, password } = proxy;
    let url;
    try {
        // new URL('127.0.0.1:8080') throws
        // new URL('localhost:8080') fails to parse host or protocol
        // In both of these cases, we need to try re-parse URL with `http://` prefix.
        url = new URL(server);
        if (!url.host || !url.protocol)
            url = new URL(`http://${server}`);
    }
    catch (_e) {
        url = new URL(`http://${server}`);
    }
    if (username)
        url.username = username;
    if (password)
        url.password = password;
    return url;
}
/**
 * Prepare launch options for Playwright's Firefox browser.
 *
 * Note: This function only accepts `boolean` for the `headless` parameter.
 * Callers must normalize `"virtual"` to `boolean` before calling this function.
 * The virtual display setup is handled separately in the calling function.
 */
export async function launchOptions({ config, os, block_images, block_webrtc, block_webgl, disable_coop, webgl_config, geoip, humanize, locale, addons, fonts, custom_fonts_only, exclude_addons, screen, window, fingerprint, fingerprint_preset, ff_version, headless, main_world_eval, allow_addon_new_tab, executable_path, firefox_user_prefs, proxy, enable_cache, args, env, i_know_what_im_doing, debug, virtual_display, canvas_noise, geoip_db: _geoip_db, browser: _browser, ...launch_options }) {
    // Build the config
    if (!config) {
        config = {};
    }
    // Set default values for optional arguments
    const headlessBoolean = headless ?? false;
    if (!addons) {
        addons = [];
    }
    if (!args) {
        args = [];
    }
    if (!firefox_user_prefs) {
        firefox_user_prefs = {};
    }
    if (custom_fonts_only === undefined) {
        custom_fonts_only = false;
    }
    if (i_know_what_im_doing === undefined) {
        i_know_what_im_doing = false;
    }
    if (!env) {
        env = { ...process.env };
    }
    else {
        env = { ...env };
    }
    if (typeof executable_path === "string") {
        // Convert executable path to a Path object
        executable_path = path.resolve(executable_path);
    }
    // Handle virtual display
    if (virtual_display) {
        env.DISPLAY = virtual_display;
        env.GDK_BACKEND = "x11";
        delete env.WAYLAND_DISPLAY;
        env.MOZ_ENABLE_WAYLAND = "0";
    }
    // Warn the user for manual config settings
    if (!i_know_what_im_doing) {
        warnManualConfig(config);
    }
    const userSetNavigator = isDomainSet(config, "navigator.");
    const userSetScreenWindow = isDomainSet(config, "screen.", "window.");
    const userSetMediaDevices = isDomainSet(config, "mediaDevices:");
    const userSetFonts = Boolean(fonts) || isDomainSet(config, "fonts");
    const userSetVoices = isDomainSet(config, "voices");
    const userSetAppVersion = "navigator.appVersion" in config;
    dropAudioSeed(config);
    const pinnedSalt = fingerprint != null
        ? identitySalt(fingerprint)
        : fingerprint_preset && typeof fingerprint_preset === "object"
            ? identitySalt(fingerprint_preset)
            : "navigator.userAgent" in config
                ? identitySalt({ ...config })
                : identitySalt();
    const operatingSystems = validateOS(os);
    // webgl_config requires OS to be set
    if (!operatingSystems && webgl_config) {
        throw new Error("OS must be set when using webgl_config");
    }
    if (!executable_path &&
        !getAsBooleanFromENV("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", false)) {
        await ensureCamoufoxInstalled();
    }
    // Add the default addons
    await addDefaultAddons(addons, exclude_addons);
    // Confirm all addon paths are valid
    if (addons.length > 0) {
        confirmPaths(addons);
        config.addons = addons;
    }
    // Get the Firefox version
    let ff_version_str;
    if (ff_version) {
        ff_version_str = ff_version.toString();
        LeakWarning.warn("ff_version", i_know_what_im_doing);
    }
    else {
        ff_version_str = installedVerStr().split(".", 1)[0];
    }
    let usedPreset = false;
    if (fingerprint) {
        if (!i_know_what_im_doing) {
            checkCustomFingerprint(fingerprint);
        }
    }
    else if (fingerprint_preset != null) {
        const preset = typeof fingerprint_preset === "object"
            ? fingerprint_preset
            : getRandomPreset(os, ff_version_str);
        if (preset) {
            mergeInto(config, fromPreset(preset, ff_version_str, pinnedSalt));
            usedPreset = true;
        }
    }
    const screenCons = screen || getScreenCons(headlessBoolean || "DISPLAY" in env);
    if (!usedPreset && !fingerprint) {
        fingerprint = generateFingerprint(window, {
            screen: screenCons,
            operatingSystems,
        });
    }
    if (!usedPreset && fingerprint) {
        mergeInto(config, fromBrowserforge(fingerprint, ff_version_str));
    }
    dropAudioSeed(config);
    const knownProperties = loadProperties(executable_path);
    const targetOS = getTargetOS(config);
    const drawSeed = () => identitySeed(config, pinnedSalt);
    if (!userSetAppVersion) {
        const derived = appVersionFromUserAgent(String(config["navigator.userAgent"] ?? ""));
        if (derived)
            config["navigator.appVersion"] = derived;
    }
    if (!userSetNavigator || !userSetScreenWindow || !userSetMediaDevices) {
        if (!userSetScreenWindow &&
            headlessBoolean === false &&
            !virtual_display &&
            screenCons) {
            clampScreenToDisplay(config, screenCons.maxWidth, screenCons.maxHeight);
        }
        applyConfigFixes(config, targetOS, {
            navigator: !userSetNavigator,
            screen: !userSetScreenWindow,
            media: !userSetMediaDevices &&
                isLiveProperty(knownProperties, "mediaDevices:enabled"),
            salt: pinnedSalt,
        });
    }
    if (custom_fonts_only) {
        firefox_user_prefs["gfx.bundled-fonts.activate"] = 0;
        if (fonts) {
            LeakWarning.warn("custom_fonts_only");
            config.fonts = fonts;
        }
        else {
            throw new Error("No custom fonts were passed, but `custom_fonts_only` is enabled.");
        }
    }
    else if (!userSetFonts || !config.fonts?.length) {
        try {
            config.fonts = generateFontSubset(targetOS, drawSeed());
        }
        catch {
            updateFonts(config, targetOS);
        }
    }
    if (fonts && fonts.length && !custom_fonts_only) {
        config.fonts = Array.from(new Set([...(config.fonts || []), ...fonts]));
    }
    // Handle proxy
    const proxyUrl = getProxyUrl(proxy);
    // Set geolocation
    if (geoip) {
        geoipAllowed();
        // Use provided IP directly, or resolve the public IP via the proxy if provided
        if (typeof geoip !== "string") {
            geoip = await publicIP(proxyUrl?.href);
        }
        // Spoof WebRTC if not blocked
        if (!block_webrtc) {
            if (validIPv4(geoip)) {
                setInto(config, "webrtc:ipv4", geoip);
                firefox_user_prefs["network.dns.disableIPv6"] = true;
            }
            else if (validIPv6(geoip)) {
                setInto(config, "webrtc:ipv6", geoip);
            }
        }
        const geolocation = await getGeolocation(geoip);
        config = { ...config, ...geolocation.asConfig() };
    }
    // Raise a warning when a proxy is being used without spoofing geolocation.
    // This is a very bad idea; the warning cannot be ignored with i_know_what_im_doing.
    if (proxyUrl &&
        !proxyUrl.hostname.includes("localhost") &&
        !isDomainSet(config, "geolocation:")) {
        LeakWarning.warn("proxy_without_geoip");
    }
    // Set locale
    if (locale) {
        handleLocales(locale, config);
    }
    const requestedLocale = config["locale:language"]
        ? [
            config["locale:language"],
            config["locale:script"],
            config["locale:region"],
        ]
            .filter(Boolean)
            .join("-")
        : "en-US";
    firefox_user_prefs["intl.locale.requested"] ??= requestedLocale;
    if (isLiveProperty(knownProperties, "voices") &&
        (!userSetVoices || !("voices" in config))) {
        const voiceLocale = config["locale:language"]
            ? [config["locale:language"], config["locale:region"]]
                .filter(Boolean)
                .join("-")
            : config["navigator.language"];
        try {
            config.voices = generateVoiceSubset(targetOS, voiceLocale, drawSeed());
        }
        catch {
            config.voices = [];
        }
    }
    if (isLiveProperty(knownProperties, "voices:blockIfNotDefined")) {
        setInto(config, "voices:blockIfNotDefined", true);
    }
    // Pass the humanize option
    if (humanize) {
        setInto(config, "humanize", true);
        if (typeof humanize === "number") {
            setInto(config, "humanize:maxTime", humanize);
        }
    }
    // Enable the main world context creation
    if (main_world_eval) {
        setInto(config, "allowMainWorld", true);
    }
    if (allow_addon_new_tab &&
        isLiveProperty(knownProperties, "allowAddonNewtab")) {
        setInto(config, "allowAddonNewtab", true);
    }
    if (block_images)
        LeakWarning.warn("block_images", i_know_what_im_doing);
    if (disable_coop)
        LeakWarning.warn("disable_coop", i_know_what_im_doing);
    firefox_user_prefs["permissions.default.image"] ??= block_images ? 2 : 1;
    firefox_user_prefs["media.peerconnection.enabled"] ??= !block_webrtc;
    firefox_user_prefs["browser.tabs.remote.useCrossOriginOpenerPolicy"] ??=
        !disable_coop;
    const webglDisabled = Boolean(block_webgl || launch_options.allow_webgl === false);
    const namedGpu = Boolean(webgl_config || (config["webGl:vendor"] && config["webGl:renderer"]));
    let hostGpu = null;
    let coverCanvas = false;
    if (canvas_noise === true) {
        coverCanvas = true;
    }
    else if (targetOS === OS_NAME && !namedGpu) {
        if (!webglDisabled) {
            const bin = executable_path ? String(executable_path) : launchPath();
            const probed = existsSync(bin)
                ? await probeHostGpu(bin, headlessBoolean, env)
                : null;
            if (probed && !isSoftwareRenderer(probed[1])) {
                try {
                    await sampleWebGL(targetOS, probed[0], probed[1]);
                    hostGpu = probed;
                }
                catch {
                    coverCanvas = canvas_noise == null;
                }
            }
        }
    }
    else if (canvas_noise !== false) {
        coverCanvas = true;
    }
    const presentedFonts = config.fonts || [];
    if (targetOS === "win") {
        const windows11 = presentedFonts.length === 0 ||
            presentedFonts.some((font) => WINDOWS_11_MARKER_FONTS.has(font));
        firefox_user_prefs["ui.useOverlayScrollbars"] ??= windows11 ? 1 : 0;
    }
    else {
        firefox_user_prefs["ui.useOverlayScrollbars"] ??= 1;
    }
    if (targetOS === "win" && OS_NAME !== "win") {
        firefox_user_prefs["javascript.options.use_ucrt_math"] ??= true;
        setInto(config, "input:windowsKeyboard", true);
        for (const [pref, value] of Object.entries(WINDOWS_BEHAVIOUR_PREFS)) {
            firefox_user_prefs[pref] ??= value;
        }
        const overlay = firefox_user_prefs["ui.useOverlayScrollbars"];
        firefox_user_prefs["widget.non-native-theme.scrollbar.style"] ??= overlay
            ? 5
            : 4;
    }
    if (targetOS === "lin") {
        firefox_user_prefs["gfx.font_rendering.fallback.async"] ??= false;
    }
    const quotaKb = stockProfileDiskCapacityKb();
    if (quotaKb)
        firefox_user_prefs[QUOTA_FIXED_LIMIT_PREF] ??= quotaKb;
    if (webglDisabled) {
        firefox_user_prefs["webgl.disabled"] = true;
        LeakWarning.warn("block_webgl", i_know_what_im_doing);
    }
    else {
        const seed = drawSeed();
        let webgl_fp;
        if (hostGpu) {
            webgl_fp = await sampleWebGL(targetOS, hostGpu[0], hostGpu[1], seed);
        }
        else if (webgl_config) {
            webgl_fp = await sampleWebGL(targetOS, webgl_config[0], webgl_config[1], seed);
        }
        else if (config["webGl:vendor"] && config["webGl:renderer"]) {
            try {
                webgl_fp = await sampleWebGL(targetOS, config["webGl:vendor"], config["webGl:renderer"], seed);
            }
            catch {
                webgl_fp = await sampleWebGL(targetOS, undefined, undefined, seed);
            }
        }
        else {
            webgl_fp = await sampleWebGL(targetOS, undefined, undefined, seed);
        }
        const { webGl2Enabled, ...webGlConfig } = webgl_fp;
        mergeInto(config, webGlConfig);
        mergeInto(firefox_user_prefs, {
            "webgl.enable-webgl2": webGl2Enabled,
            "webgl.force-enabled": true,
        });
    }
    if (coverCanvas)
        addCanvasPlaceholder(firefox_user_prefs);
    const gpuVendor = config["webGl:vendor"];
    const gpuRenderer = config["webGl:renderer"];
    const webgpuOn = targetOS === "win" || (targetOS === "mac" && gpuVendor === "Apple");
    firefox_user_prefs["dom.webgpu.enabled"] ??= webgpuOn;
    if (webgpuOn) {
        const ownAdapter = Boolean(hostGpu && hostGpu[0] === gpuVendor && hostGpu[1] === gpuRenderer);
        firefox_user_prefs[WEBGPU_BLOCKLIST_PREF] ??= ownAdapter ? 1 : 4;
    }
    const dpr = Number(config["window.devicePixelRatio"] || 1);
    if (dpr !== 1) {
        firefox_user_prefs["layout.css.devPixelsPerPx"] ??= `${dpr}`;
    }
    // Cache previous pages, requests, etc (uses more memory)
    if (enable_cache) {
        mergeInto(firefox_user_prefs, CACHE_PREFS);
    }
    // Print the config if debug is enabled
    if (debug) {
        console.debug("[DEBUG] Config:");
        console.debug(config);
    }
    if (!isLiveProperty(knownProperties, "voices"))
        delete config.voices;
    if (!isLiveProperty(knownProperties, "allowAddonNewtab"))
        delete config.allowAddonNewtab;
    if (!isLiveProperty(knownProperties, "mediaDevices:enabled")) {
        for (const key of Object.keys(config)) {
            if (key.startsWith("mediaDevices:"))
                delete config[key];
        }
    }
    // Validate the config
    validateConfig(config, knownProperties);
    //Prepare environment variables to pass to Camoufox
    const env_vars = {
        ...getEnvVars(config, targetOS),
        ...env,
    };
    // Prepare the executable path
    if (executable_path) {
        executable_path = executable_path.toString();
    }
    else {
        executable_path = launchPath();
    }
    const out = {
        executablePath: executable_path,
        args: args,
        env: env_vars,
        firefoxUserPrefs: firefox_user_prefs,
        proxy: proxyUrl
            ? {
                server: proxyUrl.origin,
                username: proxyUrl.username,
                password: proxyUrl.password,
                bypass: typeof proxy === "string" ? undefined : proxy?.bypass,
            }
            : undefined,
        headless: headlessBoolean,
        ...launch_options,
    };
    return out;
}
