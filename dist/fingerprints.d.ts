import { type Fingerprint, type FingerprintGeneratorOptions } from "fingerprint-generator";
export declare const SUPPORTED_OS: readonly ["linux", "macos", "windows"];
export declare function fromBrowserforge(fingerprint: Fingerprint, ffVersion?: string): Record<string, any>;
export declare function generateFingerprint(window?: [number, number], config?: Partial<FingerprintGeneratorOptions>): Fingerprint;
export declare function generateFontSubset(targetOs: "win" | "mac" | "lin"): string[];
export interface FingerprintPreset {
    navigator?: Record<string, any>;
    screen?: Record<string, any>;
    webgl?: Record<string, any>;
    timezone?: string;
    fonts?: string[];
    speechVoices?: any[];
}
export declare function fromPreset(preset: FingerprintPreset, ffVersion?: string): Record<string, any>;
type PresetBundle = {
    presets?: Record<string, FingerprintPreset[]>;
};
export declare function loadPresets(): PresetBundle | null;
export declare function getRandomPreset(os?: string | string[], _ffVersion?: string): FingerprintPreset | undefined;
export declare function generateVoiceSubset(targetOs: "win" | "mac" | "lin", locale?: string): any[];
export declare function clampScreenToDisplay(config: Record<string, any>, maxWidth?: number, maxHeight?: number): void;
export declare function applyConfigFixes(config: Record<string, any>, targetOs: "win" | "mac" | "lin", parts?: {
    navigator?: boolean;
    screen?: boolean;
    media?: boolean;
}): void;
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
export declare function generateContextFingerprint(options?: ContextFingerprintOptions): Promise<ContextFingerprint>;
export {};
