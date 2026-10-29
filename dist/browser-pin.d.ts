/**
 * The browser build this library is tested with, in the same format as the
 * Python library's browser-pin.json. `camoufox fetch` installs and launches
 * exactly this build unless the user explicitly chose another one.
 */
export declare const PIN_FILE: string;
export interface BrowserPin {
    tag: string;
    repo: string;
    repoName: string;
    version: string;
    build: string;
}
export declare function pinSpec(pin: BrowserPin): string;
export declare function loadPin(file?: string): BrowserPin | null;
/**
 * The pin, unless the user chose a channel or a build themselves.
 */
export declare function effectivePin(config: {
    channel?: string;
    pinned?: string;
}): BrowserPin | null;
export declare function pinMatches(pin: BrowserPin, repoName: string, version: string, build: string): boolean;
