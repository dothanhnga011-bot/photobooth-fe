import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
        const pages = chunks.find((c) => c.facadeModuleId?.replace(/\\/g, '/').endsWith('/src/pages.jsx'));
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
      this.emitFile({
        type: 'asset',
        fileName: 'downloads/print-agent-dnp.ps1',
        source: readFileSync(new URL('./src/admin/installers/print-agent-dnp.ps1', import.meta.url)),
      });
    },
  };
}
// Album pages never render .admin-shell / .admin-login, yet about 45 % of the stylesheet is scoped
// to them, and a guest on 4G must download and parse the whole file before the album can paint.
// The build also emits a guest copy without those rules (every other rule kept, in its original
// order, so album pages render exactly the same) and the page picks it on /album/ paths. Admin,
// kiosk and all other pages keep the full stylesheet.
const ADMIN_ONLY = /^\.admin-(?:shell|login)(?![\w-])/;
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
        if (rule.selectors.every((selector) => ADMIN_ONLY.test(selector.trim()))) rule.remove();
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
      // Written by the parser while it reads <head>, so either file blocks rendering like the
      // original <link> did (no flash of unstyled content).
      const choose = `<script>window.__fullStylesheet="/${link[1]}";document.write('<link rel="stylesheet" crossorigin href="'+(location.pathname.indexOf("/album/")===0?"/${fileName}":window.__fullStylesheet)+'">')</script>` +
        `<noscript>${link[0]}</noscript>`;
      html.source = page.replace(link[0], choose);
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
