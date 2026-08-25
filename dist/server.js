import { firefox } from "playwright-core";
import { launchOptions } from "./utils.js";
export async function launchServer({ port, ws_path, ...options }) {
    // Extract and normalize headless (virtual is treated as true for server mode)
    const { headless, ...restOptions } = options;
    const normalizedHeadless = headless === "virtual" ? true : headless;
    return firefox.launchServer({
        ...(await launchOptions({ ...restOptions, headless: normalizedHeadless })),
        port,
        wsPath: ws_path,
    });
}
