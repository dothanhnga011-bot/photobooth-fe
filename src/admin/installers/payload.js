// Script PowerShell nhúng trong file cài .bat (dòng "rem TÊN_BASE64:..." sau exit /b): không tải thêm
// file, không đưa chuỗi dài vào dòng lệnh. PowerShell 5.1 cần BOM để đọc đúng tiếng Việt trong file UTF-8.
export function encodePayload(source, { bom = true } = {}) {
  const text = source.replace(/^\uFEFF/, "");
  const bytes = new TextEncoder().encode(bom ? `\uFEFF${text}` : text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
