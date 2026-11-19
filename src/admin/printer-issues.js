// Một cách tính "máy in cần xem" cho cả bảng "Máy in tự động" (Quản lý máy) lẫn chấm đỏ ở mục
// "Quản lý máy" trên thanh bên: dòng nào bảng tô vàng thì thanh bên có chấm đỏ.

// Máy in DNP RX1 của một phòng Photobooth: chương trình in đang chạy và máy in sẵn sàng.
export const roomPrinterReady = ({ agent, dnp }) => Boolean(agent?.running) && (!dnp || dnp.ready);

// Danh sách ngắn những gì đang cần xử lý (rỗng = mọi máy in ổn). Chưa có máy in nào báo về thì
// không tính là lỗi: đó là việc cài đặt, bảng ở Quản lý máy đã hướng dẫn.
export function printerIssues(printers = []) {
  return printers.flatMap((row) => {
    if (row.room)
      return roomPrinterReady(row) ? [] : [`${row.roomName || "Phòng"}: máy in DNP chưa sẵn sàng`];
    const issues = [];
    if (row.agent && !row.agent.running) issues.push(`${row.branch}: chương trình in tự động không chạy`);
    return issues;
  });
}
