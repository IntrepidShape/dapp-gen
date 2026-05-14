/**
 * Dev server for the generated dapp.
 *
 * Three steps, all native Bun + Elm:
 *
 *   1. `elm make src/Main.elm --output=elm.js`
 *   2. `bun build ports.ts --outfile=ports.js --target=browser`  (this script)
 *   3. `bun serve.ts`                                            (this script)
 *
 * Steps 2 and 3 are combined here — this file builds ports.ts on startup,
 * then serves the directory as static files. Re-run when ports.ts changes.
 * (Use `bun build --watch` separately if you want hot rebuilds.)
 *
 * Zero npm runtime deps. Zero hand-written .js. Source of truth is Elm + TS.
 */
import { file, spawnSync } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dir;
const PORT = parseInt(process.env.PORT ?? "5174", 10);

// ─── Build: ports.ts → ports.js ────────────────────────────────────────────

console.log("▸ building ports.ts …");
const build = await Bun.build({
    entrypoints: [join(HERE, "ports.ts")],
    outdir: HERE,
    target: "browser",
    format: "esm",
    minify: false,
});
if (!build.success) {
    console.error(build.logs.map(String).join("\n"));
    process.exit(1);
}
console.log(`  ↳ ports.js (${(await file(join(HERE, "ports.js")).size)} bytes)`);

if (!existsSync(join(HERE, "elm.js"))) {
    console.log("▸ elm.js missing — running elm make …");
    const r = spawnSync({
        cmd: ["elm", "make", "src/Main.elm", "--output=elm.js"],
        cwd: HERE,
    });
    if (r.exitCode !== 0) {
        console.error(r.stderr.toString());
        process.exit(1);
    }
}

// ─── Static file server ────────────────────────────────────────────────────

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".mjs":  "application/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".ico":  "image/x-icon",
};

Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        const abs = join(HERE, path);
        const f = file(abs);
        if (!(await f.exists())) {
            return new Response(`not found: ${path}`, { status: 404 });
        }
        const ext = path.slice(path.lastIndexOf("."));
        const headers = {
            "content-type": MIME[ext] ?? "application/octet-stream",
            "cache-control": "no-cache",
        };
        return new Response(f, { headers });
    },
});

console.log(`▸ dapp serving at http://localhost:${PORT}`);
