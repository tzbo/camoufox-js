import { Version } from "./pkgman.js";
/**
 * The Python library's multi-version layout (multiversion.py), shared with it: builds live in
 * INSTALL_DIR/browsers/<repo>/<version>-<build>[-<sha8>]/ and config.json records the active
 * one and whether the user chose a channel or a build.
 */
export declare const browsersDir: () => string;
export declare const configFile: () => string;
export declare const compatFlag: () => string;
export interface CamoufoxConfig {
    active_version?: string | null;
    channel?: string;
    pinned?: string;
    pinned_sha?: string;
    [key: string]: unknown;
}
export declare function loadConfig(): CamoufoxConfig;
export declare function saveConfig(config: CamoufoxConfig): void;
export declare function setActive(relativePath: string): void;
export declare function getRepoName(githubRepo: string): string;
export declare function versionFolderName(version: string, build: string, sha256?: string): string;
export interface InstalledVersion {
    repoName: string;
    version: Version;
    path: string;
    relativePath: string;
    isActive: boolean;
    isPrerelease: boolean;
    sha256?: string;
}
/**
 * Builds in browsers/, sorted by repo, then newest first.
 */
export declare function listInstalled(): InstalledVersion[];
/**
 * The build to launch: the pinned one unless the user explicitly chose another, else the
 * active one. Null when that build isn't installed. Unlike the Python library, it doesn't
 * record the result in config.json, as launches may run concurrently or from a read-only dir.
 */
export declare function getActivePath(): string | null;
