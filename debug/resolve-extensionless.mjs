// Tiny ESM loader hook so plain `node` can import this project's
// extensionless relative imports (the app relies on webpack/Next.js's
// bundler resolution, which allows `from "./cvLabels"` with no ".js" —
// Node's native ESM loader requires the extension). Debug-only; never
// used by the app itself.
import { existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw err;
    for (const ext of [".js", ".mjs", "/index.js"]) {
      const candidate = specifier + ext;
      try {
        return await nextResolve(candidate, context);
      } catch {}
    }
    throw err;
  }
}
