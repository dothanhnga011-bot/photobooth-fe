// Một cách tính "máy in cần xem" cho cả bảng "Máy in tự động" (Quản lý máy) lẫn chấm đỏ ở mục
// "Quản lý máy" trên thanh bên: dòng nào bảng tô vàng thì thanh bên có chấm đỏ.

// Hộp phim Instax Wide có 10 tấm: còn ≤ 3 tấm thì nhắc thay phim.
export const FILM_LOW = 3;

// Máy in DNP của một phòng: chương trình in trên mini PC đang chạy và máy in sẵn sàng.
export const roomPrinterReady = ({ agent, dnp }) => Boolean(agent?.running) && (!dnp || dnp.ready);

export const instaxLow = (instax) =>
  Boolean(instax?.ready) && Number.isInteger(instax.film) && instax.film <= FILM_LOW;
export const instaxOk = (instax) => Boolean(instax?.ready) && !instaxLow(instax);

// Danh sách ngắn những gì đang cần xử lý (rỗng = mọi máy in ổn). Chưa có máy in nào báo về thì
// không tính là lỗi: đó là việc cài đặt, bảng ở Quản lý máy đã hướng dẫn.
export function printerIssues(printers = []) {
  return printers.flatMap((row) => {
    if (row.room)
      return roomPrinterReady(row) ? [] : [`${row.roomName || "Phòng"}: máy in DNP chưa sẵn sàng`];
    const issues = [];
    if (row.agent && !row.agent.running) issues.push(`${row.branch}: chương trình in tự động không chạy`);
    if (row.instax && !instaxOk(row.instax))
      issues.push(`Máy Instax: ${instaxLow(row.instax) ? "sắp hết phim" : row.instax.message || "chưa sẵn sàng"}`);
    return issues;
  });
}
