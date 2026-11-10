// Đường mạng tải lên của tiệm có hạn (ba máy chụp dùng chung): việc khách đang chờ đi trước — ảnh xem
// trước (album có ảnh ngay), tờ in Instax, ảnh ghép. Ảnh gốc 15 MB của máy ảnh chỉ bắt đầu gửi khi không
// còn việc nào trong số đó đang gửi (whenUplinkIdle), để không chia băng thông với chúng.
let busy = 0;
const waiters = new Set();

// Chạy một việc ưu tiên: trong lúc chạy, ảnh gốc chưa bắt đầu gửi tấm mới.
export async function priority(task) {
  busy++;
  try {
    return await task();
  } finally {
    busy--;
    if (!busy) for (const wake of [...waiters]) wake();
  }
}

export const uplinkBusy = () => busy > 0;

export const whenUplinkIdle = () =>
  busy
    ? new Promise((resolve) => {
        const wake = () => {
          waiters.delete(wake);
          resolve();
        };
        waiters.add(wake);
      })
    : Promise.resolve();
