import { type Browser, type BrowserContext, type BrowserContextOptions, type BrowserType } from "playwright-core";
import { type FingerprintPreset } from "./fingerprints.js";
import { type LaunchOptions } from "./utils.js";
export declare function Camoufox<UserDataDir extends string | undefined = undefined, ReturnType = UserDataDir extends string ? BrowserContext : Browser>(launch_options?: LaunchOptions & {
    user_data_dir?: UserDataDir;
}): Promise<ReturnType>;
export declare function NewBrowser<UserDataDir extends string | false = false, ReturnType = UserDataDir extends string ? BrowserContext : Browser>(playwright: BrowserType<Browser>, headless?: boolean | "virtual", fromOptions?: Record<string, any>, userDataDir?: UserDataDir, debug?: boolean, launch_options?: LaunchOptions): Promise<ReturnType>;
export interface NewContextOptions extends BrowserContextOptions {
    preset?: FingerprintPreset;
    os?: string | string[];
    ff_version?: string;
    webrtc_ip?: string;
    timezone?: string;
    locale?: string;
    config_overrides?: Record<string, any>;
}
export declare function NewContext(browser: Browser, options?: NewContextOptions): Promise<BrowserContext>;
