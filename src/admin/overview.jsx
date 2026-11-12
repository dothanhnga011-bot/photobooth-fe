import { useEffect, useRef, useState } from "react";
import { CalendarDays, Camera, Plus, Printer } from "lucide-react";
import { labels, localDate } from "../api";
import { isConnectivityError } from "../network.js";
import { useLiveData } from "../use-live-data";
import { Button, ErrorBox, useToast } from "../studio";
import { CounterTicket } from "../counter-ticket";
import { SummaryPanel } from "./summary";

const clockOf = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const ROOM_STATE = { free: "Đang trống", starting: "Đang vào phòng", shooting: "Đang chụp" };

// Một phòng chụp: trạng thái, đồng hồ + thanh thời gian khi đang chụp, máy chụp có đang mở không.
function RoomTile({ room, offset }) {
  const now = Date.now() - offset;
  const shooting = room.status === "shooting";
  const total = shooting && room.startedAt ? new Date(room.endsAt) - new Date(room.startedAt) : 0;
  const left = shooting ? new Date(room.endsAt) - now : 0;
  const machine = shooting && !room.online
    ? ["warn", "Máy chụp mất tín hiệu"]
    : room.machine || room.online
      ? ["on", "Máy chụp đang mở"]
      : ["off", "Máy chụp chưa mở"];
  return (
    <article className={`room-tile ${room.status}`}>
      <header className="room-tile-heading">
        <span className="room-avatar" aria-hidden="true"><Camera size={18} /></span>
        <div className="room-tile-name">
          <strong>{room.name}</strong>
          {room.branch && <small>{room.branch}</small>}
        </div>
        <span className="room-state">{ROOM_STATE[room.status] || ROOM_STATE.free}</span>
      </header>
      <div className="room-tile-body">
        {shooting ? (
          <>
            <div className="room-clock-row">
              <span className="room-clock">{clockOf(left)}</span>
              <small>còn lại</small>
            </div>
            {total > 0 && (
              <div className="room-progress" role="progressbar" aria-label="Thời gian chụp đã dùng"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, Math.round(100 - (100 * left) / total)))}>
                <i style={{ width: `${Math.min(100, Math.max(0, 100 - (100 * left) / total))}%` }} />
              </div>
            )}
            <p>#{room.code}{room.customer ? ` · ${room.customer}` : ""}</p>
          </>
        ) : room.status === "starting" ? (
          <p>Khách đang vào phòng · #{room.code}</p>
        ) : (
          <p>Sẵn sàng — mời khách tiếp theo</p>
        )}
      </div>
      <footer className={`room-machine is-${machine[0]}`}>{machine[1]}</footer>
    </article>
  );
}

export function Overview({ notify, canSeeMoney, assignedBranch }) {
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [today, setToday] = useState([]);
  const [live, setLive] = useState(null);
  const [creating, setCreating] = useState(false);
  const [sales, setSales] = useState(0);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);
  const lastError = useRef("");
  const onError = (e) => {
    setError(e.message);
    // Mất kết nối: thông báo chung của trang đã báo, không lặp ở từng bảng.
    if (lastError.current !== e.message && !isConnectivityError(e)) toast.error(e.message);
    lastError.current = e.message;
  };
  const onData = (set) => (data) => {
    set(data);
    setError("");
    lastError.current = "";
  };
  const reloadStats = useLiveData(
    "/admin/stats",
    onData(setStats),
    onError,
    30000,
  );
  const reloadToday = useLiveData(
    `/admin/bookings?date=${localDate()}`,
    onData(setToday),
    onError,
    20000,
  );
  // Phòng đang chụp / đang trống: làm mới 5 giây/lần, đồng hồ đếm lùi từng giây.
  useLiveData(
    "/admin/rooms/live",
    onData((d) => setLive({ ...d, offset: Date.now() - d.now })),
    onError,
    5000,
  );
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const rooms = live?.rooms || [];
  const freeRooms = rooms.filter((r) => r.status === "free").length;
  return (
    <>
      <ErrorBox error={error} />
      <div className="overview-date">
        <CalendarDays size={17} aria-hidden="true" />
        <time dateTime={localDate()}>
          {new Intl.DateTimeFormat("vi-VN", {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: "Asia/Ho_Chi_Minh",
          }).format(new Date())}
        </time>
      </div>
      <section className="panel room-board">
        <div className="room-board-head">
          <div>
            <h3>Phòng chụp lúc này</h3>
            {live ? (
              <div className="room-board-counts">
                <span className="is-free">{freeRooms} trống</span>
                <span className="is-shooting">{rooms.filter((r) => r.status === "shooting").length} đang chụp</span>
                {rooms.some((r) => r.status === "starting") && (
                  <span className="is-starting">{rooms.filter((r) => r.status === "starting").length} đang vào phòng</span>
                )}
              </div>
            ) : (
              <p className="room-board-summary">Đang tải trạng thái phòng…</p>
            )}
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} /> Tạo mã chụp
          </Button>
        </div>
        <div className="room-board-grid">
          {rooms.map((r) => <RoomTile key={r._id} room={r} offset={live.offset} />)}
          {live && !rooms.length && (
            <p className="muted">
              Chưa có phòng chụp. Thêm phòng trong mục Quản lý máy.
            </p>
          )}
        </div>
      </section>
      {stats && (
        <>
          <div className="stats-grid">
            {[
              ["Mã chụp hôm nay", stats.today, CalendarDays],
              ["Lệnh in đang chờ", stats.printQueue ?? 0, Printer],
            ]
              .filter(Boolean)
              .map(([l, v, Icon, note]) => (
                <div className="stat-card" key={l}>
                  <span>
                    <Icon size={16} /> {l}
                  </span>
                  <strong>{v}</strong>
                  {note && <small>{note}</small>}
                </div>
              ))}
          </div>
          <SummaryPanel
            refreshKey={sales}
            canSeeMoney={canSeeMoney}
            assignedBranch={assignedBranch}
            onError={onError}
          />
          <div className="dashboard-grid">
            <section className="panel">
              <h3>Mã vừa được cấp</h3>
              {today
                .filter((b) => b.status !== "cancelled")
                .slice(0, 8)
                .map((b) => (
                  <div className="today-booking" key={b._id}>
                    <strong>#{b.code}</strong>
                    <div>
                      {b.name}
                      <small>{b.roomName || "Chưa vào phòng"}</small>
                    </div>
                    <span className={`badge ${b.status}`}>
                      {labels[b.status]}
                    </span>
                  </div>
                ))}
              {!today.length && <p>Chưa có mã chụp hôm nay.</p>}
            </section>
            <section className="panel occupancy-panel">
              <h3>Số lượt chụp hôm nay</h3>
              {stats.occupancy?.map((r) => (
                <div className="occupancy-row" key={r.name}>
                  <div>
                    <strong>{r.name}</strong>
                    <small>{r.branch}</small>
                  </div>

                  <div className="occupancy-bar">
                    <i
                      style={{
                        width: `${(r.booked / Math.max(1, ...stats.occupancy.map((x) => x.booked))) * 100}%`,
                      }}
                    />
                  </div>
                  <span>{r.booked} lượt khách</span>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
      {creating && (
        <CounterTicket
          assignedBranch={assignedBranch}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            reloadToday();
            reloadStats();
            setSales((n) => n + 1);
            notify(`Đã cấp mã #${t.code} cho ${t.name}.`);
          }}
        />
      )}
    </>
  );
}
