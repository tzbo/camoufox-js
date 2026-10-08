/**
 * Camoufox version constants.
 */
export class CONSTRAINTS {
    /**
     * The minimum and maximum supported versions of the Camoufox browser.
     */
    static MIN_VERSION = "alpha.1";
    /**
     * Exclusive. The Firefox 156 builds (beta.32+) dropped properties this library still generates.
     */
    static MAX_VERSION = "beta.32";
    /**
     * Minimum version with Playwright 1.61+, which sends viewport fields that older builds reject.
     */
    static PLAYWRIGHT_1_61_MIN_VERSION = "beta.30";
}
