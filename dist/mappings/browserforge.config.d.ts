/**
 * Mappings of Browserforge fingerprints to Camoufox config properties.
 */
declare const _default: {
    navigator: {
        userAgent: string;
        doNotTrack: string;
        appVersion: string;
        oscpu: string;
        platform: string;
        hardwareConcurrency: string;
        maxTouchPoints: string;
        extraProperties: {
            globalPrivacyControl: string;
        };
    };
    screen: {
        availLeft: string;
        availTop: string;
        availWidth: string;
        availHeight: string;
        height: string;
        width: string;
        colorDepth: string;
        pixelDepth: string;
        outerHeight: string;
        outerWidth: string;
        screenX: string;
        screenY: string;
    };
    headers: {
        "Accept-Encoding": string;
    };
};
export default _default;
