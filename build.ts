import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";
import { SveltePlugin } from "bun-plugin-svelte";
const root = import.meta.dir;
const webDir = path.join(root, "web");
const publicDir = path.join(root, "public");
const assetsDir = path.join(publicDir, "assets");
const staticDir = path.join(webDir, "static");

await rm(assetsDir, { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });

const appCssIn = path.join(webDir, "src/app.css");
const appCssOut = path.join(assetsDir, "app.css");
await $`tailwindcss -i ${appCssIn} -o ${appCssOut} --minify`.cwd(webDir);

const result = await Bun.build({
  entrypoints: [path.join(webDir, "src/main.ts")],
  outdir: assetsDir,
  target: "browser",
  plugins: [SveltePlugin()],
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}

const jsFile = result.outputs.find((o) => o.path.endsWith(".js"));
if (!jsFile) {
  console.error("No JS output from build");
  process.exit(1);
}

const jsName = path.basename(jsFile.path);

const swResult = await Bun.build({
  entrypoints: [path.join(webDir, "src/sw.ts")],
  outdir: publicDir,
  target: "browser",
  format: "iife",
  define: {
    BUILD_PRECACHE: JSON.stringify([
      `/assets/${jsName}`,
      "/assets/prefs-init.js",
      "/assets/app.css",
    ]),
  },
});

if (!swResult.success) {
  console.error(swResult.logs);
  process.exit(1);
}

const swOut = swResult.outputs.find((o) => o.path.endsWith(".js"));
if (swOut) {
  await Bun.write(path.join(publicDir, "sw.js"), swOut);
}

await cp(staticDir, publicDir, { recursive: true });

// Served as a file, not inlined: the page's CSP allows no inline script.
const prefsInitScript = `(function () {
  try {
    var l = localStorage.getItem("nanoflux-locale");
    var loc;
    if (l === "en" || l === "zh-Hans" || l === "zh-Hant") loc = l;
    else if (l === "zh") loc = "zh-Hans";
    else {
      var nav = (navigator.language || "").toLowerCase();
      if (nav.indexOf("en") === 0) loc = "en";
      else if (nav.indexOf("zh") === 0 && (nav.indexOf("hant") >= 0 || nav.indexOf("-tw") >= 0 || nav.indexOf("-hk") >= 0 || nav.indexOf("-mo") >= 0)) loc = "zh-Hant";
      else loc = "zh-Hans";
    }
    document.documentElement.lang = loc === "en" ? "en" : loc === "zh-Hant" ? "zh-TW" : "zh-CN";
    var desc = loc === "en" ? "News Service for AI Agents" : loc === "zh-Hant" ? "面向 AI Agent 的新聞服務" : "面向 AI Agent 的新闻服务";
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", desc);
    var mf = document.querySelector('link[rel="manifest"]');
    if (mf) mf.href = "/manifest.webmanifest?locale=" + loc;
    var t = localStorage.getItem("nanoflux-theme");
    if (t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches))
      document.documentElement.classList.add("dark");
    var fs = localStorage.getItem("nanoflux-font-size");
    if (!localStorage.getItem("nanoflux-font-size-v2") && fs === "small")
      fs = "medium";
    if (fs === "large")
      document.documentElement.classList.add("font-large");
    else if (fs === "small")
      document.documentElement.classList.add("font-small");
  } catch (e) {}
})();
`;
await writeFile(path.join(assetsDir, "prefs-init.js"), prefsInitScript);

await writeFile(
  path.join(publicDir, "index.html"),
  `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="description" content="面向 AI Agent 的新闻服务" />
    <meta name="theme-color" content="#171717" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="NanoFlux" />
    <title>NanoFlux</title>
    <link rel="manifest" href="/manifest.webmanifest?locale=zh-Hans" />
    <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <script src="/assets/prefs-init.js"></script>
    <link rel="stylesheet" href="/assets/app.css" />
    <script type="module" crossorigin src="/assets/${jsName}"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`,
);

console.log(`Built frontend → public/index.html, public/assets/${jsName}`);
