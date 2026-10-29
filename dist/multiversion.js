import * as fs from "node:fs";
import * as path from "node:path";
import { effectivePin, pinMatches } from "./browser-pin.js";
import { INSTALL_DIR, Version } from "./pkgman.js";
/**
 * The Python library's multi-version layout (multiversion.py), shared with it: builds live in
 * INSTALL_DIR/browsers/<repo>/<version>-<build>[-<sha8>]/ and config.json records the active
 * one and whether the user chose a channel or a build.
 */
// pkgman imports this module too, so paths are resolved on use rather than at load.
export const browsersDir = () => path.join(INSTALL_DIR.toString(), "browsers");
export const configFile = () => path.join(INSTALL_DIR.toString(), "config.json");
export const compatFlag = () => path.join(INSTALL_DIR.toString(), ".0.5_FLAG");
export function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(configFile(), "utf-8"));
    }
    catch {
        return {};
    }
}
export function saveConfig(config) {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    // Through a rename, so a concurrent reader never sees a half-written file.
    const tmp = `${configFile()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, configFile());
}
export function setActive(relativePath) {
    saveConfig({ ...loadConfig(), active_version: relativePath });
}
// Folder names of the Python library's repos.yml entries.
const REPO_NAMES = { "daijro/camoufox": "official" };
export function getRepoName(githubRepo) {
    return REPO_NAMES[githubRepo] ?? githubRepo.split("/")[0].toLowerCase();
}
export function versionFolderName(version, build, sha256) {
    const base = `${version}-${build}`;
    return sha256 ? `${base}-${sha256.slice(0, 8)}` : base;
}
/**
 * Builds in browsers/, sorted by repo, then newest first.
 */
export function listInstalled() {
    const installed = [];
    if (!fs.existsSync(browsersDir()))
        return installed;
    const active = loadConfig().active_version;
    for (const repo of fs.readdirSync(browsersDir(), { withFileTypes: true })) {
        if (!repo.isDirectory() || repo.name.startsWith("."))
            continue;
        const repoDir = path.join(browsersDir(), repo.name);
        for (const folder of fs.readdirSync(repoDir, { withFileTypes: true })) {
            const dir = path.join(repoDir, folder.name);
            const versionJson = path.join(dir, "version.json");
            if (!folder.isDirectory() || !fs.existsSync(versionJson))
                continue;
            try {
                const data = JSON.parse(fs.readFileSync(versionJson, "utf-8"));
                const relativePath = `browsers/${repo.name}/${folder.name}`;
                installed.push({
                    repoName: repo.name,
                    version: Version.fromPath(dir),
                    path: dir,
                    relativePath,
                    isActive: relativePath === active,
                    isPrerelease: data.prerelease ?? false,
                    sha256: data.sha256 ?? undefined,
                });
            }
            catch {
                // A corrupt version.json is not a usable install.
            }
        }
    }
    const compare = (a, b) => a.lessThan(b) ? -1 : b.lessThan(a) ? 1 : 0;
    return installed.sort((a, b) => (a.repoName < b.repoName ? 1 : a.repoName > b.repoName ? -1 : 0) ||
        compare(b.version, a.version));
}
/**
 * The build to launch: the pinned one unless the user explicitly chose another, else the
 * active one. Null when that build isn't installed. Unlike the Python library, it doesn't
 * record the result in config.json, as launches may run concurrently or from a read-only dir.
 */
export function getActivePath() {
    const config = loadConfig();
    const active = config.active_version;
    const pin = effectivePin(config);
    if (pin) {
        const inst = listInstalled().find((v) => pinMatches(pin, v.repoName, v.version.version ?? "", v.version.release));
        return inst?.path ?? null;
    }
    if (active) {
        const activePath = path.join(INSTALL_DIR.toString(), active);
        if (fs.existsSync(path.join(activePath, "version.json"))) {
            return activePath;
        }
    }
    if (!config.channel && !config.pinned) {
        const [newest] = listInstalled();
        if (newest)
            return newest.path;
    }
    return null;
}
