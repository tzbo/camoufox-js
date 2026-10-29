import type { PathLike } from "node:fs";
import type { Writable } from "node:stream";
export declare const OS_NAME: "mac" | "win" | "lin";
/**
 * Directory the Camoufox browser is downloaded to and launched from.
 * Defaults to the per-user cache directory; set CAMOUFOX_INSTALL_DIR to
 * relocate it (e.g. into a container image layer when the home directory
 * is ephemeral or persisted separately).
 */
export declare const INSTALL_DIR: PathLike;
export declare const LOCAL_DATA: PathLike;
export declare const OS_ARCH_MATRIX: {
    [key: string]: string[];
};
export declare class Version {
    release: string;
    version?: string;
    sorted_rel: number[];
    constructor(release: string, version?: string);
    private buildSortedRel;
    get fullString(): string;
    equals(other: Version): boolean;
    lessThan(other: Version): boolean;
    isSupported(): boolean;
    static fromPath(filePath?: PathLike): Version;
    static isSupportedPath(path: PathLike): boolean;
    static buildMinMax(): [Version, Version];
}
export declare class GitHubDownloader {
    githubRepo: string;
    apiUrl: string;
    constructor(githubRepo: string);
    checkAsset(asset: any, _release?: any): any;
    releasesUrl(): string;
    missingAssetError(): void;
    getAsset({ retries }?: {
        retries: number;
    }): Promise<any>;
}
export declare class CamoufoxFetcher extends GitHubDownloader {
    arch: string;
    _version_obj?: Version;
    pattern: RegExp;
    _url?: string;
    isPrerelease: boolean;
    sha256?: string;
    createdAt?: string;
    constructor();
    init(): Promise<void>;
    releasesUrl(): string;
    checkAsset(asset: any, release?: any): [Version, string] | null;
    missingAssetError(): void;
    static getPlatformArch(): string;
    fetchLatest(): Promise<void>;
    static downloadFile(url: string): Promise<Buffer>;
    extractZip(zipFile: string | Buffer, destDir?: string): Promise<void>;
    static cleanup(): boolean;
    setVersion(destDir?: string): void;
    private static removeLeftovers;
    private static activate;
    install(): Promise<void>;
    get url(): string;
    get version(): string;
    get release(): string;
    get verstr(): string;
}
export declare function installedVerStr(): string;
/**
 * @param _downloadIfMissing Ignored, downloads happen in {@link ensureCamoufoxInstalled}.
 */
export declare function camoufoxPath(_downloadIfMissing?: boolean): PathLike;
/**
 * Installs the pinned build when no supported install is available, as the Python
 * library does on launch. An explicitly chosen build is never replaced.
 */
export declare function ensureCamoufoxInstalled(): Promise<void>;
export declare function getPath(file: string): string;
export declare function launchPath(): string;
export declare function webdl(url: string, desc?: string, bar?: boolean, buffer?: Writable | null, { retries }?: {
    retries: number;
}): Promise<Buffer>;
export declare function unzip(zipFile: Buffer, extractPath: string, desc?: string, bar?: boolean): Promise<void>;
