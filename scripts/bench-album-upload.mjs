// Live browser/R2 benchmark, synthetic data only. Never calls the production API or MongoDB.
// Run from photobooth-fe: node scripts/bench-album-upload.mjs --live-r2 --baseline=HEAD --rounds=2
// Temporary objects use one unique prefix and are deleted after every run and again on exit.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "../../photobooth-be/node_modules/playwright/index.mjs";
import { config } from "../../photobooth-be/src/config.js";
import { R2_REF, r2Storage, validateR2Config } from "../../photobooth-be/src/services/r2.js";
import { inspectStoredOriginal } from "../../photobooth-be/src/services/direct-upload.js";

const args = process.argv.slice(2);
if (!args.includes("--live-r2")) {
  console.log("Pass --live-r2 to upload synthetic test files to the configured R2 bucket and remove them afterwards.");
  process.exit(0);
}
const option = (key, fallback) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
const root = fileURLToPath(new URL("..", import.meta.url));
const photoCount = Number(option("photos", "12"));
const requestedRounds = Number(option("rounds", "2"));
const firstVariant = option("first", "old");
assert.ok(Number.isInteger(photoCount) && photoCount >= 1 && photoCount <= 12);
assert.ok(Number.isInteger(requestedRounds) && requestedRounds >= 1 && requestedRounds <= 3);
assert.ok(["old", "new"].includes(firstVariant));
const baseline = execFileSync("git", ["rev-parse", option("baseline", "HEAD")], { cwd: root, encoding: "utf8" }).trim();
const oldSource = execFileSync("git", ["show", `${baseline}:src/kiosk/direct-upload.js`], { cwd: root, encoding: "utf8" });
assert.doesNotMatch(oldSource, /createUploadPool/, "baseline must precede the shared two-slot upload pool");
const currentSource = await readFile(join(root, "src/kiosk/direct-upload.js"), "utf8");
const output = resolve(root, option("output", ".cache/bench-album-upload.json"));
const requireBackend = createRequire(new URL("../../photobooth-be/package.json", import.meta.url));
const sharp = requireBackend("sharp");
const { ListObjectsV2Command } = requireBackend("@aws-sdk/client-s3");
const MB = 1024 * 1024;
const origin = "https://mellowptb.com";
const namespace = `bench-album-upload-${randomUUID()}`;
const prefix = `${R2_REF}${config.r2.prefix.replace(/\/?$/, "/")}${namespace}/`;
const base = `${origin}/__${namespace}/`;
const ledger = join(root, ".cache", `${namespace}-cleanup.json`);
const allFiles = new Set(), manifest = new Map();
let browser, page, client, activeRun;
let journal = Promise.resolve();
const results = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const log = (event, detail = {}) => console.log(JSON.stringify({ event, ...detail }));
const recordFiles = () => {
  const content = JSON.stringify({ prefix, files:[...allFiles], pid:process.pid });
  journal = journal.then(() => writeFile(ledger, content+"\n"));
  return journal;
};

async function cleanup(files) {
  if (!files.length) return;
  assert.ok(files.every((file) => file.startsWith(prefix)), "refuse to remove anything outside this benchmark prefix");
  await r2Storage.deleteMany(files);
}

const fixture = `
  import * as oldUpload from 'virtual:old-upload';
  import * as newUpload from 'virtual:new-upload';
  import { flushOriginalPhotos } from 'virtual:network-tasks';
  let image, video;
  window.prepareBenchmark = async () => {
    [image, video] = await Promise.all(['photo.jpg', 'video.mp4'].map(async name =>
      (await fetch(new URL(name, location.href))).blob()));
    return { photoBytes: image.size, videoBytes: video.size };
  };
  window.runBenchmark = async ({ variant, count, withVideo, run }) => {
    const upload = variant === 'old' ? oldUpload : newUpload;
    upload.resetDirectUploads();
    let rows = Array.from({length: count}, (_, i) => ({
      id: run + '-photo-' + String(i + 1).padStart(2,'0'), token: run,
      stage: 'original', originalAt: i + 1, image,
    }));
    let photoMs, videoMs, completed = 0;
    const errors = [];
    const start = performance.now();
    const remove = async id => {
      rows = rows.filter(row => row.id !== id);
      completed++;
      void window.benchmarkProgress({run, kind:'photo', completed, ms:performance.now()-start});
    };
    const photos = (async () => {
      if (variant === 'old') {
        for (const row of [...rows]) { await upload.saveOriginal(run, row); await remove(row.id); }
      } else {
        await flushOriginalPhotos({ concurrency:3, isActive:()=>true,
          readPending:async()=>rows, upload:row=>upload.saveOriginal(run,row),
          removePending:remove, savePending:async row=>{ rows=rows.map(p=>p.id===row.id?row:p); },
          onError:(_row,error)=>errors.push(error.status || error.code || error.name),
        });
      }
      photoMs=performance.now()-start;
    })();
    const movie = withVideo ? upload.saveVideo(video, run).then(()=>{
      videoMs=performance.now()-start;
      void window.benchmarkProgress({run, kind:'video', ms:videoMs});
    }) : Promise.resolve();
    const outcomes = await Promise.allSettled([photos,movie]);
    if (outcomes.some(outcome=>outcome.status==='rejected') || rows.length || errors.length)
      throw new Error('Benchmark upload failed; remaining='+rows.length+'; errors='+errors.join(','));
    return {variant,run,photoMs,videoMs,totalMs:performance.now()-start,completed};
  };
`;

try {
  validateR2Config();
  client = r2Storage.client();
  await mkdir(dirname(ledger), {recursive:true});
  await recordFiles();
  log("preparing", { photoCount, requestedRounds, namespace, baseline: baseline.slice(0, 12), network: "live R2; API fixture on current PC; no production database" });
  // A high-detail, valid 26 MP JPEG, near the camera's typical file weight. Same
  // immutable JPEG in every trial. Video is random 30 MiB payload, not an encode test.
  const width = 6240, height = 4160;
  const photo = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 78, chromaSubsampling: "4:2:0" }).toBuffer();
  const video = randomBytes(30 * MB);
  const fixtures = { photoBytes: photo.length, videoBytes: video.length, photoPixels: width * height,
    photoSha256: hash(photo), videoSha256: hash(video) };
  log("fixtures", { ...fixtures, batchMiB: (photoCount * photo.length + video.length) / MB });
  const virtualOld = "\0benchmark-old-upload";
  const bundle = await build({
    configFile: false, logLevel: "error",
    define: { "import.meta.env.VITE_API_URL": '""' },
    build: { write: false, minify: false, rollupOptions: { input: "virtual:benchmark" } },
    plugins: [{
      name: "album-upload-benchmark", enforce: "pre",
      resolveId(id, importer) {
        if (id === "virtual:benchmark") return "\0benchmark-entry";
        if (id === "virtual:old-upload") return virtualOld;
        if (id === "virtual:new-upload") return join(root, "src/kiosk/direct-upload.js");
        if (id === "virtual:network-tasks") return join(root, "src/kiosk/network-tasks.js");
        if (importer === virtualOld && id.startsWith(".")) return resolve(root, "src/kiosk", id);
      },
      load(id) { return id === "\0benchmark-entry" ? fixture : id === virtualOld ? oldSource : null; },
    }],
  });
  const assets = new Map(bundle.output.map((asset) => [asset.fileName, asset.code || asset.source]));
  const entry = bundle.output.find((asset) => asset.isEntry).fileName;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.exposeFunction("benchmarkProgress", (detail) => log("progress", detail));
  await page.route(base + "**", async (route) => {
    const path = route.request().url().slice(base.length);
    if (path === "photo.jpg") return route.fulfill({contentType:"image/jpeg",body:photo});
    if (path === "video.mp4") return route.fulfill({contentType:"video/mp4",body:video});
    if (assets.has(path)) return route.fulfill({contentType:"application/javascript",body:assets.get(path)});
    return route.fulfill({contentType:"text/html",body:`<script type="module" src="${base}${entry}"></script>`});
  });
  await page.route(origin + "/api/**", async (route) => {
    try {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!(request.headers()["content-type"] || "").includes("application/json")) {
        activeRun.fallbacks++;
        return route.fulfill({status:400,json:{message:"Benchmark requires direct R2 uploads, no proxy fallback."}});
      }
      const data = request.postDataJSON();
      const isVideo = path.includes("/kiosk/video/");
      if (path.endsWith("/original-url") || path.endsWith("/video/upload-url")) {
        const stored = randomUUID(), type = isVideo ? "video/mp4" : "image/jpeg";
        const file = `${prefix}${activeRun.name}/${stored}.${isVideo ? "mp4" : "jpg"}`;
        const size = data.size;
        allFiles.add(file); activeRun.files.push(file);
        await recordFiles();
        manifest.set(stored, { file, size, isVideo, committed:false });
        const url = await r2Storage.signedPut(file, 900, type, size);
        return route.fulfill({json:{upload:{url,stored}}});
      }
      const item = manifest.get(data.stored);
      assert.ok(item && item.file.startsWith(`${prefix}${activeRun.name}/`));
      if (item.isVideo) assert.equal((await r2Storage.head(item.file))?.ContentLength, item.size);
      else assert.equal((await inspectStoredOriginal(item.file)).size, item.size);
      item.committed = true;
      return route.fulfill({json:{attached:true,ok:true}});
    } catch (error) {
      activeRun.errors.push(error.name);
      return route.fulfill({status:400,json:{message:"Benchmark validation failed."}});
    }
  });
  await page.goto(base);
  await page.waitForFunction(() => typeof window.runBenchmark === "function");
  assert.deepEqual(await page.evaluate(() => window.prepareBenchmark()), {
    photoBytes: photo.length, videoBytes: video.length,
  });
  const run = async (variant, name, count, withVideo, verify) => {
    activeRun = {name,files:[],fallbacks:0,errors:[]};
    log("run-start", {variant,run:name,count,withVideo});
    const watchdog = setTimeout(() => {
      log("run-timeout", {run:name});
      void page.close().catch(() => {});
    }, 180000);
    try {
      const result = await page.evaluate((options) => window.runBenchmark(options), {variant,run:name,count,withVideo});
      assert.equal(activeRun.fallbacks, 0);
      assert.deepEqual(activeRun.errors, []);
      const stored = [...manifest.values()].filter((item) => item.file.startsWith(`${prefix}${name}/`));
      assert.equal(stored.length, count + Number(withVideo));
      assert.ok(stored.every((item) => item.committed));
      if (verify) {
        for (const isVideo of [false, true].filter((kind) => !kind || withVideo)) {
          const item = stored.find((item) => item.isVideo === isVideo);
          assert.equal(hash(await r2Storage.read(item.file)), isVideo ? fixtures.videoSha256 : fixtures.photoSha256);
        }
      }
      result.directUploads = stored.length;
      result.bytes = count * photo.length + (withVideo ? video.length : 0);
      log("run-complete", result);
      return result;
    } finally {
      clearTimeout(watchdog);
      await cleanup(activeRun.files);
      log("run-cleaned", {run:name,objects:activeRun.files.length});
    }
  };
  const pilot = await run("new", "warmup", 1, false, true);
  const estimatedSerialMs = pilot.totalMs * (photoCount + video.length / photo.length);
  const rounds = requestedRounds;
  log("plan", {rounds,estimatedSerialMs});
  for (let round = 0; round < rounds; round++) {
    const order = firstVariant === "old" ? ["old", "new"] : ["new", "old"];
    for (const variant of round % 2 ? order.reverse() : order)
      results.push(await run(variant, `${variant}-${round + 1}`, photoCount, true, true));
  }
  const median = (values) => { const sorted=[...values].sort((a,b)=>a-b), mid=Math.floor(sorted.length/2); return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2; };
  const summary = Object.fromEntries(["old","new"].map((variant) => {
    const runs = results.filter((row) => row.variant === variant);
    return [variant, Object.fromEntries(["photoMs","videoMs","totalMs"].map((field) => [field,median(runs.map((row)=>row[field]))]))];
  }));
  const speedup = Object.fromEntries(["photoMs","videoMs","totalMs"].map((field) => [field,summary.old[field]/summary.new[field]]));
  const report = {timestamp:new Date().toISOString(),timezone:"Asia/Ho_Chi_Minh",browser:browser.version(),baseline,firstVariant,
    currentUploadSha256:hash(currentSource),method:"Live Chromium PUTs to R2, API intercepted locally; no Render/MongoDB writes or timings; all files ready at start; video payload excludes encoding",fixtures,photoCount,rounds,pilot,results,summary,speedup,cleanup:"all uniquely prefixed objects deleted after every run"};
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+"\n");
  log("result", {summary,speedup,output});
} catch (error) {
  log("failed", {name:error.name,message:error.message?.includes("Benchmark")?error.message:"Benchmark could not complete; no production records were changed."});
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (client) {
    try {
      await journal;
      await cleanup([...allFiles]);
      const remaining = await r2Storage.send(ListObjectsV2Command,null,{Prefix:prefix.slice(R2_REF.length),MaxKeys:1});
      assert.equal(remaining.Contents?.length || 0,0);
      await unlink(ledger);
      log("cleanup-complete",{objects:allFiles.size,verifiedEmpty:true});
    }
    catch(error) { process.exitCode=1; log("cleanup-failed",{name:error.name,prefix}); }
    client.destroy();
  }
}
