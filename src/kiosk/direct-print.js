import { printPackUpload } from '../album/print-upload.js';

export const LOCAL_PRINT_URL = 'http://127.0.0.1:8789';

// No automatic retries or cloud queue fallback: a disconnected response can follow a real print.
export async function sendDirectPrint(job, { fetcher = fetch, base = LOCAL_PRINT_URL } = {}) {
  let health;
  try {
    const response = await fetcher(`${base}/health`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Local printer unavailable');
    health = await response.json();
    if (health.directPrint !== 2) throw new Error('Update the local printer agent');
  } catch {
    throw new Error('Chưa kết nối chương trình in trực tiếp. Chạy lại bộ cài máy in của phòng và cho phép trình duyệt kết nối mạng cục bộ.');
  }
  const upload = printPackUpload(job);
  if (upload.body.size > 64 * 1024 * 1024) throw new Error('File in vượt 64 MB. Nhờ nhân viên kiểm tra số bản in.');
  let response;
  try {
    response = await fetcher(`${base}/print`, {
      method: 'POST', body: upload.body,
      headers: { ...upload.headers, 'Content-Type': 'application/octet-stream', 'X-Album-Token': job.token },
      signal: AbortSignal.timeout(180000),
    });
  } catch {
    throw new Error('Mất xác nhận in trực tiếp. Kiểm tra khay RX1 trước khi in lại; phần mềm không tự gửi lại để tránh in trùng.');
  }
  const result = await response.json();
  if (!response.ok || !result.sent) throw new Error(result.message || 'RX1 chưa nhận được ảnh. Nhờ nhân viên kiểm tra máy in.');
  return result;
}
