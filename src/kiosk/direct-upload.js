import { api } from "../api.js";
import { photoUpload } from "../photo-upload.js";
import { cleanCameraJpeg } from "./jpeg-clean.js";
import { putToStorage } from "./storage-upload.js";
import { createUploadPool } from "./network-tasks.js";
import { whenUplinkIdle } from "./uplink.js";

// Camera originals (~15 MB) go from the booth straight to storage instead of through the free
// server: the booth asks the API for a short-lived upload URL for this photo, uploads the JPEG it
// cleaned of private metadata, then commits the photo with only its small preview. Whenever that
// is not possible (older server, storage not allowing the upload yet, a file still being written)
// the photo is sent the usual way, so nothing is ever lost.
// Selfbooth's short recovery: retry direct storage after 30s, then 60s/120s
// after repeated failures. Photo and video retain independent backoffs.
const DIRECT_PAUSE_MS = 30000;
const directOffUntil = { photo: 0, video: 0 };
const directFailures = { photo: 0, video: 0 };
const pauseDirect = kind => { directOffUntil[kind] = Date.now() + DIRECT_PAUSE_MS * 2 ** Math.min(directFailures[kind]++, 2); };
const directSucceeded = kind => { directOffUntil[kind] = directFailures[kind] = 0; };
const backgroundUploads = createUploadPool(2);
const backgroundUpload = (task) => backgroundUploads.run(async () => {
  await whenUplinkIdle();
  return task();
});
// Uploads already in storage whose commit did not get an answer: a retry commits them again
// instead of uploading 15 MB a second time.
const storedUploads = new Map();
const storedOriginals = new Map();

// Video đã nằm trên kho mà chưa xác nhận được: thử lại thì chỉ xác nhận, không tải lại cả video.
let storedVideos = new WeakMap();

export const resetDirectUploads = () => {
  directOffUntil.photo = directOffUntil.video = 0;
  directFailures.photo = directFailures.video = 0;
  storedUploads.clear(); storedOriginals.clear(); storedVideos = new WeakMap();
};

const isStorageUrl = (src) => {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.hostname.endsWith(".r2.cloudflarestorage.com");
  } catch { return false; }
};

// path: "/kiosk/photo" during the session, "/albums/<token>/photos" afterwards.
// guest: a guest adding a photo from their phone (album page): only that phone sees it. The booth never sets it.
export async function savePhoto(path, image, options = {}) {
  const replyHeaders = {
    ...(options.onlyNewPhoto && { 'X-Photo-Reply': 'delta' }),
    ...(options.guest && { 'X-Album-Guest': '1' }),
  };
  const viaServer = () => {
    const request = photoUpload(image, options);
    return api(path, { ...request, headers: { ...request.headers, ...replyHeaders } });
  };
  const { clientKey, captureToken, preview } = options;
  if (!(image instanceof Blob) || !(preview instanceof Blob) || !preview.size || !clientKey)
    return viaServer();
  let stored = storedUploads.get(clientKey);
  if (!stored) {
    if (Date.now() < directOffUntil.photo) return viaServer();
    let file;
    try {
      file = await cleanCameraJpeg(image);
    } catch {
      return viaServer(); // not a complete JPEG: the server gives the usual answer
    }
    let ticket;
    try {
      ticket = await api(`${path}/upload-url`, {
        method: "POST",
        headers: replyHeaders,
        body: { clientKey, size: file.size, ...(captureToken && { captureToken }) },
      });
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.status !== 404) throw error;
      return viaServer(); // older server, other storage, or the session just ended
    }
    // Saved already (an earlier reply was lost): trust it only if this very photo is there.
    if (ticket?.saved && ticket.booking?.photos?.some((p) => p.clientKey === clientKey))
      return ticket.booking;
    if (!isStorageUrl(ticket?.upload?.url) || typeof ticket.upload.stored !== "string") return viaServer();
    try {
      await putToStorage(ticket.upload.url, file);
      directSucceeded('photo');
    } catch {
      // Storage not reachable from this page (e.g. its CORS rules do not allow uploads yet):
      // use the server for a while instead of failing every photo first.
      pauseDirect('photo');
      return viaServer();
    }
    stored = ticket.upload.stored;
    storedUploads.set(clientKey, stored);
  }
  try {
    const result = await api(path, {
      method: "POST",
      timeout: 60000,
      retry: 1,
      body: preview,
      headers: {
        ...replyHeaders,
        "X-Photo-Key": clientKey,
        "X-Photo-Stored": stored,
        ...(captureToken && { "X-Capture-Token": captureToken }),
        ...(options.mirrored !== undefined && { "X-Photo-Mirrored": options.mirrored ? "1" : "0" }),
        ...(options.name !== undefined && { "X-Photo-Name": encodeURIComponent(options.name) }),
      },
    });
    storedUploads.delete(clientKey);
    return result;
  } catch (error) {
    // The stored upload cannot be used (422): send the photo the usual way.
    if (error.status === 422) {
      storedUploads.delete(clientKey);
      return viaServer();
    }
    throw error; // connection or session state: the queue retries with the same upload
  }
}

// Ảnh xem trước tới trước: chỉ gửi ảnh xem trước 1600 px của máy chụp (~0,3 MB thay vì 15 MB) — máy
// chủ lưu nó làm ảnh trong album ngay, khách quét QR là thấy ảnh. Ảnh gốc gửi sau (saveOriginal).
// row: dòng ảnh chờ gửi trên máy ({ id, image, preview, mirrored }).
export function savePreview(path, row, { captureToken } = {}) {
  return api(path, {
    method: "POST",
    timeout: 60000,
    retry: 1,
    body: row.preview,
    headers: {
      "X-Photo-Key": row.id,
      "X-Photo-Original": "later",
      "X-Photo-Reply": "delta",
      ...(captureToken && { "X-Capture-Token": captureToken }),
      ...(row.mirrored !== undefined && { "X-Photo-Mirrored": row.mirrored ? "1" : "0" }),
    },
  });
}

// Ảnh gốc của máy ảnh cho ảnh album đã có (đang hiện ảnh xem trước): thẳng lên kho R2 rồi báo máy chủ
// gắn vào ảnh; kho MongoDB, trang chưa được kho cho tải lên (CORS) hoặc tệp trên kho không dùng được
// thì gửi tệp qua máy chủ. Lỗi 410 / 404 (ảnh hoặc album không còn): người gọi bỏ dòng ảnh đó.
export async function saveOriginal(token, row) {
  await whenUplinkIdle();
  const base = `/albums/${token}/photos/original`;
  let file;
  try {
    file = await cleanCameraJpeg(row.image);
  } catch {
    file = row.image; // tệp chưa trọn vẹn: máy chủ tự kiểm tra và trả lỗi như thường
  }
  const body = file.type === "image/jpeg" ? file : file.slice(0, file.size, "image/jpeg");
  const viaServer = () => backgroundUpload(() => api(base, { method: "POST", body, timeout: 600000, headers: { "X-Photo-Key": row.id } }));
  const key = `${token}:${row.id}`;
  let stored = storedOriginals.get(key);
  if (!stored) {
    if (Date.now() < directOffUntil.photo) return viaServer();
    let ticket;
    try {
      ticket = await api(`${base}-url`, { method: "POST", body: { clientKey: row.id, size: body.size } });
    } catch (error) {
      if (error.status === 404) return viaServer();
      throw error;
    }
    if (ticket?.saved) return ticket;
    if (!isStorageUrl(ticket?.upload?.url) || typeof ticket.upload.stored !== "string") return viaServer();
    try {
      await backgroundUpload(() => putToStorage(ticket.upload.url, body, { timeout: 600000 }));
      directSucceeded('photo');
    } catch {
      pauseDirect('photo');
      return viaServer();
    }
    stored = ticket.upload.stored;
    storedOriginals.set(key, stored);
  }
  try {
    const result = await api(base, { method: "POST", timeout: 60000, retry: 1, body: { clientKey: row.id, stored } });
    storedOriginals.delete(key);
    return result;
  } catch (error) {
    if ([404, 410, 422].includes(error.status)) storedOriginals.delete(key);
    if (error.status === 422) return viaServer();
    throw error;
  }
}

// Video tua nhanh (tới ~48 MB) thẳng lên kho R2 như ảnh gốc: máy chủ free không phải nhận và giữ cả
// video trong bộ nhớ, video lên album nhanh hơn. Kho MongoDB, trang chưa được kho cho tải lên (CORS)
// hoặc tệp trên kho không dùng được: gửi qua máy chủ như trước. video: Blob loại video/mp4 | video/webm.
export async function saveVideo(video, captureToken) {
  await whenUplinkIdle();
  const viaServer = () => backgroundUpload(() => api("/kiosk/video", {
    method: "POST",
    body: video,
    timeout: 180000,
    headers: { "X-Capture-Token": captureToken },
  }));
  let stored = storedVideos.get(video);
  if (!stored) {
    if (Date.now() < directOffUntil.video) return viaServer();
    let ticket;
    try {
      ticket = await api("/kiosk/video/upload-url", {
        method: "POST",
        body: { captureToken, type: video.type, size: video.size },
      });
    } catch {
      return viaServer(); // kho MongoDB (404), máy chủ cũ, hoặc phiên vừa hết
    }
    if (!isStorageUrl(ticket?.upload?.url) || typeof ticket.upload.stored !== "string") return viaServer();
    try {
      await backgroundUpload(() => putToStorage(ticket.upload.url, video, { contentType: video.type, timeout: 600000 }));
      directSucceeded('video');
    } catch {
      pauseDirect('video');
      return viaServer();
    }
    stored = ticket.upload.stored;
    storedVideos.set(video, stored);
  }
  try {
    const result = await api("/kiosk/video/commit", {
      method: "POST",
      timeout: 30000,
      retry: 1,
      body: { captureToken, stored },
    });
    storedVideos.delete(video);
    return result;
  } catch (error) {
    if (error.status === 422) {
      storedVideos.delete(video);
      return viaServer();
    }
    throw error; // mất mạng: lần thử sau chỉ xác nhận lại video đã tải lên
  }
}
