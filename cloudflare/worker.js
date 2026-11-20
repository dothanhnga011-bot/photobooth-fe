const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// If-None-Match against an ETag, weak comparison (RFC 9110 §13.1.2): W/"x" matches "x".
const opaque = (tag) => tag.trim().replace(/^W\//, "");
function unchanged(ifNoneMatch, etag) {
  if (!ifNoneMatch || !etag) return false;
  if (ifNoneMatch.trim() === "*") return true;
  return ifNoneMatch.split(",").some((tag) => opaque(tag) === opaque(etag));
}

// Render's free server sleeps after 15 minutes without traffic and then takes about a minute to
// wake, so the first guest of the morning or someone opening an album late in the evening waited.
// A cron trigger (wrangler.jsonc) pings it every 10 minutes from 06:00 to 01:00 Vietnam time:
// 19 h a day ≈ 590 of the 750 free instance hours a month, whether or not a shop screen is open.
const AWAKE_FROM_HOUR = 6, AWAKE_UNTIL_HOUR = 1; // Asia/Ho_Chi_Minh (UTC+7, no daylight saving)
function keepAwakeNow(time) {
  const hour = (new Date(time).getUTCHours() + 7) % 24;
  return hour >= AWAKE_FROM_HOUR || hour < AWAKE_UNTIL_HOUR;
}

// Tên miền chính của tiệm (wrangler.jsonc → PUBLIC_ORIGIN, vd. https://mellowptb.com). Trang chủ, quản
// trị và album mở bằng địa chỉ phụ *.workers.dev được chuyển sang tên miền chính: liên kết máy chụp, mã QR
// album và file cài tạo ra từ đó đều mang tên miền chính, và kho ảnh R2 chỉ cần cho phép tên miền đó.
// Trang máy chụp (/kiosk) và API KHÔNG chuyển: ảnh chưa gửi, quyền camera / thư mục ảnh và cài đặt của
// máy chụp gắn với địa chỉ đang mở; máy in và máy chụp cũ vẫn gọi API ở địa chỉ cũ.
const MOVED_PAGES = /^\/(?:$|admin(?:\/|$)|album\/)/;
export function canonicalRedirect(incoming, env) {
  if (!env.PUBLIC_ORIGIN || !incoming.hostname.endsWith(".workers.dev") || !MOVED_PAGES.test(incoming.pathname))
    return null;
  let target;
  try {
    target = new URL(env.PUBLIC_ORIGIN);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || target.origin === incoming.origin) return null;
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  // 302: trình duyệt không nhớ mãi, đổi tên miền sau này không bị kẹt.
  return Response.redirect(target.toString(), 302);
}

// Pages and files (wrangler.jsonc: not_found_handling "none", so a request matching no file comes here).
// A missing file in a long-cached folder (/assets: hashed build output, public/_headers caches it a year
// as "immutable"; /fonts) answers a 404 that nothing stores. Answering it with the app's page — the
// Cloudflare single-page-application fallback did — put that page in browsers' cache for a year under
// the stylesheet's name when a page was opened while a new version was being switched in, and the admin
// stayed unstyled after every normal reload (20/11). Every other path is an app page: index.html.
const LONG_CACHED_FILES = /^\/(?:assets|fonts)\//;
async function staticResponse(request, env, incoming) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) return response;
  if (LONG_CACHED_FILES.test(incoming.pathname)) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }
  return env.ASSETS.fetch(new Request(new URL("/", incoming), request));
}

function apiError(status, message) {
  return Response.json({ message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname !== "/api" && !incoming.pathname.startsWith("/api/")) {
      const moved = ["GET", "HEAD"].includes(request.method) && canonicalRedirect(incoming, env);
      return moved || staticResponse(request, env, incoming);
    }

    // Enforce browser origin here BEFORE translating it for the existing backend.
    // This keeps CSRF protection without listing this site in Render's CLIENT_URL.
    const origin = request.headers.get("Origin");
    if (origin && origin !== incoming.origin) {
      return apiError(403, "Nguồn yêu cầu không hợp lệ.");
    }
    if (!SAFE_METHODS.has(request.method) && !origin &&
        request.headers.get("Sec-Fetch-Site") === "cross-site") {
      return apiError(403, "Nguồn yêu cầu không hợp lệ.");
    }

    let upstream;
    try {
      upstream = new URL(env.API_ORIGIN);
    } catch {
      return apiError(503, "Cấu hình kết nối máy chủ chưa hợp lệ.");
    }
    // API_ORIGIN is deployment configuration, never a user-supplied proxy target.
    const localHttp = upstream.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(upstream.hostname);
    if ((upstream.protocol !== "https:" && !localHttp) || upstream.username || upstream.password) {
      return apiError(503, "Cấu hình kết nối máy chủ chưa hợp lệ.");
    }
    upstream.pathname = incoming.pathname;
    upstream.search = incoming.search;

    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) {
      if (name === "host" || name === "forwarded" || name.startsWith("x-forwarded-") ||
          name.startsWith("access-control-") || name === "x-real-ip") {
        headers.delete(name);
      }
    }
    // Render trusts one reverse proxy. Keep the backend's canonical host/protocol,
    // and the genuine Cloudflare client IP for its rate limits.
    headers.set("X-Forwarded-Proto", upstream.protocol.slice(0, -1));
    headers.set("X-Forwarded-Host", upstream.host);
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (clientIp) headers.set("X-Forwarded-For", clientIp);
    if (origin) headers.set("Origin", upstream.origin);

    let response;
    try {
      response = await fetch(upstream, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
        // Do not cache album data, signed media URLs or authenticated responses.
        cache: "no-store",
        duplex: "half",
        signal: request.signal,
      });
    } catch {
      // Do not replay uploads, payments or print requests after a lost response.
      return apiError(502, "Chưa kết nối được máy chủ. Vui lòng thử lại.");
    }

    const outgoingHeaders = new Headers(response.headers);
    for (const name of [...outgoingHeaders.keys()]) {
      if (name.startsWith("access-control-")) outgoingHeaders.delete(name);
    }
    // Keep the backend's own caching rule, as the browser would get it from Render: album data
    // and signed-link redirects are "private" (this browser only, revalidated or short-lived), so
    // an unchanged album poll is an empty 304; hashed frame images are "public, immutable" and are
    // not downloaded again. This Worker never stores responses itself (fetch cache: "no-store").
    // A response without a rule is not stored anywhere.
    if (!outgoingHeaders.has("Cache-Control")) outgoingHeaders.set("Cache-Control", "no-store");
    const location = outgoingHeaders.get("Location");
    if (location) {
      const redirect = new URL(location, upstream);
      if (redirect.origin === upstream.origin) {
        outgoingHeaders.set("Location", `${incoming.origin}${redirect.pathname}${redirect.search}${redirect.hash}`);
      }
    }
    // Render answers a revalidation through this subrequest with the full body even when
    // nothing changed (measured: 200 here, 304 when asked directly). Answer it here, so an
    // unchanged album poll costs the phone an empty 304 instead of the whole album again.
    if (response.status === 200 && ["GET", "HEAD"].includes(request.method) &&
        unchanged(request.headers.get("If-None-Match"), outgoingHeaders.get("ETag"))) {
      response.body?.cancel().catch(() => {});
      for (const name of ["Content-Length", "Content-Type", "Content-Encoding", "Content-Range", "Content-Disposition"])
        outgoingHeaders.delete(name);
      return new Response(null, { status: 304, headers: outgoingHeaders });
    }
    // Return streams unchanged: full JPEGs/ICC metadata, print files and SSE must
    // never be decoded, recompressed, buffered or retried by this proxy.
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outgoingHeaders,
    });
  },

  // Cron (every 10 minutes): keep the Render server awake during the hours guests use the site.
  async scheduled(controller, env, ctx) {
    if (!keepAwakeNow(controller.scheduledTime)) return;
    let health;
    try {
      health = new URL("/api/health", env.API_ORIGIN);
    } catch {
      return;
    }
    if (health.protocol !== "https:") return;
    ctx.waitUntil(fetch(health, { cache: "no-store" })
      .then((response) => response.body?.cancel())
      .catch(() => {}));
  },
};
