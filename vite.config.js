import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import postcss from 'postcss';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { printerColorInstaller } from './src/admin/printer-installer.js';

// Guests open the album from a QR code on a phone. Its code is a separate chunk that the browser
// only discovered after the main bundle had run (measured live on 4G). On /album/ pages a tiny
// inline script near the top of <head> (before the stylesheets, which would hold it back)
// modulepreloads the album screen's chunks together with the main bundle. The album list itself
// is requested by main.jsx as soon as it runs (a fetch preload of it was measured not to be
// reused by the app's request). Other pages (admin, kiosk) are unchanged.
function albumRoutePreload() {
  return {
    name: 'album-route-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const chunks = Object.values(ctx.bundle || {}).filter((c) => c.type === 'chunk');
        const pages = chunks.find((c) =>
          c.facadeModuleId?.replace(/\\/g, '/').endsWith('/src/pages.jsx') ||
          c.moduleIds?.some((id) => id.replace(/\\/g, '/').endsWith('/src/pages.jsx')),
        );
        if (!pages) return html;
        const files = new Set();
        const visit = (name) => {
          if (files.has(name)) return;
          files.add(name);
          for (const dep of ctx.bundle[name]?.imports || []) visit(dep);
        };
        visit(pages.fileName);
        const already = new Set([...html.matchAll(/(?:src|href)="\/([^"]+\.js)"/g)].map((m) => m[1]));
        const urls = [...files].filter((f) => !already.has(f)).map((f) => '/' + f);
        const script = `<script>(function(){var m=/^\\/album\\/([^/?#]+)/.exec(location.pathname);if(!m)return;` +
          `function add(rel,href,as,cors){var l=document.createElement("link");l.rel=rel;l.href=href;if(as)l.as=as;l.crossOrigin=cors;document.head.appendChild(l)}` +
          `${JSON.stringify(urls)}.forEach(function(h){add("modulepreload",h,"","")})})()</script>`;
        return html.replace(/(<meta name="viewport"[^>]*>)/, `$1\n    ${script}`);
      },
    },
  };
}
// The DNP print agent (src/admin/installers/print-agent-dnp.ps1) is also published at
// /downloads/print-agent-dnp.ps1: agents already installed on the rooms' mini PCs fetch it from there
// and update themselves (Update-Self in the script), so a fix needs no new install at the shop.
function printAgentDownload() {
  return {
    name: 'print-agent-download',
    apply: 'build',
    generateBundle() {
      const colorScript = readFileSync(new URL('./src/admin/installers/configure-rx1-color.ps1', import.meta.url), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'downloads/configure-rx1-color.ps1', source: colorScript });
      this.emitFile({ type: 'asset', fileName: 'downloads/cai-mau-RX1.bat', source: printerColorInstaller(colorScript) });
      this.emitFile({
        type: 'asset',
        fileName: 'downloads/print-agent-dnp.ps1',
        source: readFileSync(new URL('./src/admin/installers/print-agent-dnp.ps1', import.meta.url)),
      });
      // Ảnh cho tờ "In thử độ nét" khi máy in của phòng chưa in tờ nào (bình thường dùng tờ in gần nhất).
      this.emitFile({
        type: 'asset',
        fileName: 'downloads/rx1-sharpness-sample.jpg',
        source: readFileSync(new URL('./src/admin/assets/rx1-preview-default.jpg', import.meta.url)),
      });
      // Chương trình mạch Arduino đếm xung máy nhận tiền: tải từ Cài đặt máy chụp → Máy nhận tiền → Hướng dẫn.
      this.emitFile({
        type: 'asset',
        fileName: 'downloads/bill-acceptor-pulse.ino',
        source: readFileSync(new URL('./hardware/bill-acceptor-pulse/bill-acceptor-pulse.ino', import.meta.url)),
      });
    },
  };
}
// Album pages never render admin or kiosk screens, yet a large part of the stylesheet is
// scoped to them, and a guest on 4G must download and parse the whole file before painting.
// The build also emits a guest copy without admin-only or kiosk-only rules (every shared rule
// kept, in its original order, so album pages render identically) and picks it on /album/ paths.
// Admin and kiosk pages keep (or load via ensureFullStylesheet) the full stylesheet.
const GUEST_UNUSED_ROOT = /^(?:\.admin-(?:shell|login|content|sidebar|main|header|user|nav|menu|toolbar|eyebrow|role|table|page-description)(?![\w-])|\.login-(?:page|art|form|guest)(?![\w-])|\.stats-grid(?![\w-])|\.stat-card(?![\w-])|\.dashboard-grid(?![\w-])|\.welcome-banner(?![\w-])|\.today-booking(?![\w-])|\.occupancy-|\.revenue-|\.storage-|\.order-|\.frames-|\.frame-(?:region|image|editor|board|zone|slot-preview)(?![\w-])|\.counter-(?:ticket|receipt|compose)(?![\w-])|\.rx1-|\.quick-kiosk(?![\w-])|\.selfbooth-import(?![\w-])|\.booking-table(?![\w-])|\.printer-status(?![\w-])|\.catalog-(?:toolbar|loading|results|counts|search|editor)(?![\w-])|\.package-catalog(?![\w-])|\.package-card(?![\w-])|\.extra-price(?![\w-])|\.resource-editor(?![\w-])|\.service-tabs(?![\w-])|\.theme-manager(?![\w-])|:root\[data-kiosk-theme|\.kiosk-(?!confirm(?:-card)?(?![\w-]))|\.shoot-|\.ptb-frame(?![\w-])|\.select-(?:screen|panel|preview|grid|shot|tabs|tab-panel|adjust|decor|layout|empty)(?![\w-])|\.code-(?:screen|card|keypad)(?![\w-])|\.voucher-keypad(?![\w-])|\.done-(?:screen|cards|card|title|print|sync|qr|empty)(?![\w-])|\.decor-(?:canvas|tools|tabs|panel|fonts|symbols|presets|palette|stickers)(?![\w-])|\.adjust-(?:photo|controls|sliders|grid)(?![\w-])|\.flow-(?:head|foot)(?![\w-]))/;

function splitCommaTopLevel(text) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function isGuestUnused(selector) {
  const s = selector.trim();
  const pseudo = /^:(?:is|where)\(/.exec(s);
  if (pseudo) {
    let depth = 0, end = -1;
    for (let i = pseudo[0].length - 1; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")" && --depth === 0) { end = i; break; }
    }
    if (end > 0) {
      const inner = splitCommaTopLevel(s.slice(pseudo[0].length, end));
      if (inner.length && inner.every((branch) => isGuestUnused(branch))) return true;
    }
  }
  return GUEST_UNUSED_ROOT.test(s);
}

function guestStylesheet() {
  return {
    name: 'guest-stylesheet',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = bundle['index.html'];
      if (!html) return;
      const page = String(html.source);
      const link = /<link rel="stylesheet" crossorigin href="\/(assets\/[^"]+\.css)">/.exec(page);
      if (!link || !bundle[link[1]]) this.error('guest-stylesheet: main stylesheet not found in index.html');
      const root = postcss.parse(String(bundle[link[1]].source));
      root.walkRules((rule) => {
        if (rule.selectors.every((selector) => isGuestUnused(selector))) rule.remove();
      });
      // @media / @layer / @supports blocks left empty.
      for (let emptied = true; emptied; ) {
        emptied = false;
        root.walkAtRules((at) => {
          if (at.nodes && !at.nodes.length) {
            at.remove();
            emptied = true;
          }
        });
      }
      const source = root.toString();
      const fileName = `assets/guest-${createHash('sha256').update(source).digest('hex').slice(0, 8)}.css`;
      this.emitFile({ type: 'asset', fileName, source });
      // pages.jsx lazy-loads SelfboothAlbum; Vite lists the entry CSS (link[1]) in its __vite__mapDeps
      // preload array. On /album/ paths the guest copy is already active in <head>, so pointing
      // pages's preload dep at fileName avoids downloading the discarded full stylesheet when opening
      // a Selfbooth album. Rollup writes chunks from an internal snapshot before user generateBundle
      // hooks mutate chunk.code, so we patch the emitted file on disk in writeBundle instead.
      this._guestPatch = { indexCss: link[1], guestCss: fileName };
      // Written by the parser while it reads <head>, so either file blocks rendering like the
      // original <link> did (no flash of unstyled content). If the stylesheet does not arrive (a page
      // opened while Cloudflare is switching to a new version: new HTML, CSS not there yet), fetch it
      // again past the browser cache — /assets files are cached a year as "immutable", so a broken copy
      // kept there (before 20/11 a missing file came back as the app's HTML page) is never asked for
      // again by a normal reload — then reload: at most every 30 s, so an offline page does not loop.
      // A refused file (HTML instead of CSS) fires "load" with an empty sheet rather than "error".
      const retry = 'window.__cssRetry=function(l){try{if(l.sheet&&l.sheet.cssRules.length)return;' +
        'var k="nxc-css-retry",t=+sessionStorage.getItem(k)||0;if(Date.now()-t<30000)return;' +
        'sessionStorage.setItem(k,String(Date.now()));var go=function(){location.reload()};' +
        'fetch(l.href,{cache:"reload"}).then(go,go)}catch(e){}};';
      const choose = `<script>${retry}window.__fullStylesheet="/${link[1]}";document.write('<link rel="stylesheet" crossorigin onload="__cssRetry(this)" onerror="__cssRetry(this)" href="'+(location.pathname.indexOf("/album/")===0?"/${fileName}":window.__fullStylesheet)+'">')</script>` +
        `<noscript>${link[0]}</noscript>`;
      html.source = page.replace(link[0], choose);
    },
    writeBundle(options, bundle) {
      // Patch the emitted pages-*.js on disk: replace the full index-*.css reference inside
      // __vite__mapDeps with the lighter guest-*.css so /album/ routes never download the
      // admin-heavy full stylesheet. We do this in writeBundle because Rollup writes chunks
      // from an internal snapshot; mutations to chunk.code in generateBundle are not reflected
      // in the output file.
      if (!this._guestPatch) return;
      const { indexCss, guestCss } = this._guestPatch;
      const outDir = options.dir || 'dist';
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.moduleIds?.some((id) => id.replace(/\\/g, '/').endsWith('/src/pages.jsx'))) {
          const filePath = `${outDir}/${chunk.fileName}`;
          const original = readFileSync(filePath, 'utf8');
          const patched = original.replaceAll(indexCss, guestCss);
          if (patched !== original) writeFileSync(filePath, patched);
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.API_PROXY_TARGET || 'http://localhost:8080';
  // Thử máy local với API thật (API_PROXY_TARGET=https://…): máy chủ chỉ nhận yêu cầu từ trang của nó,
  // nên proxy gửi Origin của máy chủ thay cho http://localhost:5173.
  const proxy = {
    '/api': {
      target,
      changeOrigin: true,
      configure: (server) => server.on('proxyReq', (req) => {
        if (req.getHeader('origin')) req.setHeader('origin', new URL(target).origin);
      }),
    },
  };
  return {
    plugins: [react(), tailwindcss(), albumRoutePreload(), guestStylesheet(), printAgentDownload()],
    server: { host: '0.0.0.0', port: 5173, strictPort: true, proxy },
    preview: { port: 5173, strictPort: true, proxy },
    build: {
      rollupOptions: {
        output: {
          // React + router tách thành một tệp riêng (~300 KB, gần như không đổi): mỗi lần deploy chỉ
          // tải lại phần mã ứng dụng, thư viện còn trong cache của trình duyệt.
          manualChunks(id) {
            if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) return 'vendor';
          },
        },
      },
    },
  };
});
