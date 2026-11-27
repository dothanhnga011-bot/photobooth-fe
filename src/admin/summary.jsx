import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Banknote, Landmark, Layers, Package, Printer, Ticket, TrendingUp, DoorOpen, Wallet } from "lucide-react";
import { formatDate, localDate, money } from "../api";
import { useLiveData } from "../use-live-data";
import { RangeFilter, rangeQuery } from "./date-range";

const percent = (part, whole) =>
  whole ? `${Math.round((part / whole) * 1000) / 10}%`.replace(".", ",") : "0%";

function Growth({ value, previous, format }) {
  if (value === undefined) return null;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <small className={`kpi-growth ${up ? "up" : "down"}`}>
      <Icon size={14} aria-hidden="true" />
      {`${Math.abs(value).toLocaleString("vi-VN")}%`} so với kỳ trước
      {previous !== undefined && <span> ({format(previous)})</span>}
    </small>
  );
}

function Ranking({ title, icon: Icon, rows, unit, canSeeMoney, empty }) {
  const top = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="panel ranking-panel">
      <h3>
        <Icon size={17} aria-hidden="true" /> {title}
      </h3>
      {rows.length ? (
        <ol className="ranking-list">
          {rows.map((row, index) => (
            <li key={row.name}>
              <span className="ranking-rank" aria-hidden="true">{index + 1}</span>
              <div className="ranking-body">
                <div className="ranking-line">
                  <strong title={row.name}>{row.name}</strong>
                  <span>
                    {row.count} {unit}
                    {canSeeMoney && row.revenue !== undefined && <> · {money(row.revenue)}</>}
                  </span>
                </div>
                <div className="occupancy-bar" aria-hidden="true">
                  <i style={{ width: `${(row.count / top) * 100}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </section>
  );
}

// Tổng hợp (như trang Snapbox /overview/summary): doanh thu thực nhận và số đơn so với kỳ trước,
// tiền mặt / chuyển khoản, xếp hạng chủ đề, gói chụp và máy trong khoảng ngày đã chọn.
export function SummaryPanel({ canSeeMoney, assignedBranch, onError, refreshKey = 0 }) {
  const today = localDate();
  const [range, setRange] = useState({ from: today, to: today, branch: "", room: "" });
  const [data, setData] = useState(null);
  const query = rangeQuery(range, assignedBranch);
  const reload = useLiveData(`/admin/stats/summary?${query}`, (d) => setData({ ...d, query }), onError, 60000);
  // Vừa cấp mã / thu tiền ở quầy: cập nhật số liệu ngay.
  useEffect(() => {
    if (refreshKey) reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload đổi theo khoảng ngày (useLiveData tự tải lại); ở đây chỉ khi quầy vừa thu tiền
  }, [refreshKey]);
  const loading = data?.query !== query;
  const period =
    range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`;
  return (
    <section className="summary-section" aria-labelledby="summary-title">
      <div className="summary-head">
        <div>
          <h3 id="summary-title">
            <TrendingUp size={18} aria-hidden="true" /> Tổng hợp kinh doanh
          </h3>
          <p className="muted">{period}</p>
        </div>
      </div>
      <RangeFilter value={range} onChange={setRange} assignedBranch={assignedBranch} />
      {!data ? (
        <p className="muted">Đang tải số liệu…</p>
      ) : (
        <div className={`summary-body ${loading ? "is-loading" : ""}`}>
          <div className="kpi-grid">
            {canSeeMoney && (
              <div className="stat-card kpi-card kpi-main">
                <span><Wallet size={16} aria-hidden="true" /> Doanh thu thực nhận</span>
                <strong>{money(data.revenue)}</strong>
                <Growth value={data.revenueGrowth} previous={data.previousRevenue} format={money} />
              </div>
            )}
            <div className="stat-card kpi-card">
              <span><Ticket size={16} aria-hidden="true" /> Số đơn hàng</span>
              <strong>{data.orders.toLocaleString("vi-VN")}</strong>
              <Growth value={data.ordersGrowth} previous={data.previousOrders} format={(n) => `${n} đơn`} />
            </div>
            {canSeeMoney && (
              <>
                <div className="stat-card kpi-card">
                  <span><Landmark size={16} aria-hidden="true" /> Chuyển khoản</span>
                  <strong>{money(data.transfer)}</strong>
                  <small>Chiếm {percent(data.transfer, data.revenue)}</small>
                </div>
                <div className="stat-card kpi-card">
                  <span><Banknote size={16} aria-hidden="true" /> Tiền mặt</span>
                  <strong>{money(data.cash)}</strong>
                  <small>Chiếm {percent(data.cash, data.revenue)}</small>
                </div>
              </>
            )}
            <div className="stat-card kpi-card">
              <span><Printer size={16} aria-hidden="true" /> Tờ ảnh đã gửi in</span>
              <strong>{data.sheets.toLocaleString("vi-VN")}</strong>
              <small>{data.extraSheets ? `Gồm ${data.extraSheets} tờ bán thêm` : "Chưa bán thêm tờ in"}</small>
            </div>
          </div>
          <div className="ranking-grid">
            <Ranking
              title="Xếp hạng chủ đề"
              icon={Layers}
              rows={data.themes}
              unit="lượt chọn"
              canSeeMoney={canSeeMoney}
              empty="Chưa có khách gửi in trong khoảng này."
            />
            <Ranking
              title="Xếp hạng gói chụp"
              icon={Package}
              rows={data.packages}
              unit="đơn"
              canSeeMoney={canSeeMoney}
              empty="Chưa có đơn trong khoảng này."
            />
            <Ranking
              title="Xếp hạng máy"
              icon={DoorOpen}
              rows={data.rooms}
              unit="đơn"
              canSeeMoney={canSeeMoney}
              empty="Chưa có đơn trong khoảng này."
            />
          </div>
        </div>
      )}
    </section>
  );
}
