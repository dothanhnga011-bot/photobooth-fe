// Print sheets travel as raw bytes, one after another (X-Print-Sheets lists their sizes): about a
// quarter smaller than base64 JSON, so "Gửi in" finishes sooner over a phone's upload link. The
// page and its saved attempt keep the PNG data URLs; the server fingerprints both forms alike, so
// a retry is recognised however the first request travelled.
export function dataUrlBytes(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(base64);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// printSize ("full" / "strip", không bắt buộc): khổ của khung được in — máy DNP cắt đôi tờ "strip",
// in nguyên tờ "full". Bỏ trống thì máy chủ theo khổ của gói.
export function printPackUpload({ images, frameName, requestKey, printSize }) {
  const sheets = images.map((image) => image instanceof Blob ? image : dataUrlBytes(image));
  return {
    method: "POST",
    timeout: 120000,
    // No automatic resend: while the first upload may still be saving on the server, a resend
    // could be refused for quota. A lost reply is recovered by "Kiểm tra và thử lại" (lookup first).
    body: new Blob(sheets, { type: "application/octet-stream" }),
    headers: {
      "X-Print-Key": requestKey,
      "X-Print-Frame": encodeURIComponent(frameName),
      "X-Print-Sheets": sheets.map((sheet) => sheet.size ?? sheet.length).join(","),
      ...(printSize && { "X-Print-Size": printSize }),
    },
  };
}
