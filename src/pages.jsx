import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  PiArrowsClockwiseBold as RefreshCw,
  PiClockBold,
  PiTicketBold,
} from "react-icons/pi";
import { QRCodeSVG } from "qrcode.react";
import { Button, ErrorBox, useStudio, useToast } from "./studio";
import { labels, formatDate, formatDateTime } from "./api";
import { useLiveData } from "./use-live-data";
import { isConnectivityError } from "./network.js";
import { AlbumViewer } from "./album/AlbumViewer.jsx";
import { SelfboothAlbum } from "./album/selfbooth/SelfboothAlbum.jsx";
import { isPolaroidSize } from "./print-sizes.js";

// Album coi là đã đủ khi đứng yên 3 phút (không thêm / bớt ảnh, video, ảnh ghép, không đổi trạng thái).
const ALBUM_SETTLE_MS = 3 * 60000;
const albumSignature = (b) => [
  b.status,
  (b.photos || []).map((p) => p.id || p._id).join(","),
  // Ảnh gốc độ nét cao còn đang tới (album hiện ảnh xem trước): còn làm mới nhanh tới khi đủ.
  (b.photos || []).filter((p) => p.originalPending).length,
  b.video?.size || 0,
  b.composite ? 1 : 0,
  b.mediaDeleted ? 1 : 0,
].join("|");

// Trang khách mở bằng mã QR trên máy chụp: xem và tải ảnh đã ghép khung, video và ảnh gốc. Chọn ảnh,
// ghép khung và in đều làm xong ở máy chụp nên album không còn phần chỉnh / ghép ảnh.
export function AlbumPage() {
  const { token } = useParams();
  return <AlbumSession key={token} token={token} />;
}

// Album không mở được (mã sai, đã hết hạn lưu): chỉ khách cách liên hệ tiệm thay vì chỉ báo lỗi.
function StudioContact() {
  const { settings = {} } = useStudio();
  const phone = String(settings.phone || "").trim();
  const address = String(settings.address || "").trim();
  return (
    <p className="soft-note album-contact">
      Nếu bạn vừa chụp xong, hãy quét lại mã QR trên màn hình máy chụp.
      {(phone || address) && (
        <>
          {" "}Cần hỗ trợ, liên hệ {settings.name || "tiệm"}
          {phone && <>: <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></>}
          {address && <> · {address}</>}
        </>
      )}
    </p>
  );
}

function AlbumSession({ token }) {
  const toast = useToast();
  const [booking, setBooking] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  // A slow first reply does not prove the server is sleeping. Keep retrying without inventing an ETA.
  const [slow, setSlow] = useState(false);
  const loaded = Boolean(booking);
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, [loaded]);
  const lastStatus = useRef("");
  const lastError = useRef("");
  // Ảnh / video còn đang lên album (máy chụp gửi tiếp sau khi khách bấm Chụp xong, video ghép xong
  // sau đó): album đứng yên ALBUM_SETTLE_MS mới coi là đã đủ.
  const lastChange = useRef({ signature: "", at: 0 });
  const [settled, setSettled] = useState(false);
  const reload = useLiveData(
    `/albums/${token}`,
    (b) => {
      const signature = albumSignature(b);
      if (signature !== lastChange.current.signature)
        lastChange.current = { signature, at: Date.now() };
      setSettled(b.status === "completed" && !b.photos?.some((photo) => photo.originalPending)
        && Date.now() - lastChange.current.at >= ALBUM_SETTLE_MS);
      // Khách đang xem vé thì buổi chụp kết thúc: báo ảnh đã sẵn sàng.
      if (
        lastStatus.current &&
        lastStatus.current !== "completed" &&
        b.status === "completed"
      )
        toast.success("Ảnh của bạn đã sẵn sàng!");
      lastStatus.current = b.status;
      lastError.current = "";
      setBooking(b);
      setError("");
    },
    (e) => {
      if (!booking && isConnectivityError(e)) {
        setSlow(true);
        return;
      }
      setError(e.message);
      // Before the album shows, the error box is the page itself; a toast would repeat it.
      if (booking && lastError.current !== e.message) toast.error(e.message);
      lastError.current = e.message;
    },
    // Đang chụp hoặc ảnh / video vẫn đang lên: 5 giây/lần để hiện ngay (trả lời 304 rỗng khi chưa có
    // gì mới). Album đứng yên 3 phút: 60 giây/lần (vẫn kịp làm mới link kho ảnh, hạn 5 phút) — khách
    // hay để trang mở trên điện thoại.
    settled ? 60000 : booking?.photos?.some((photo) => photo.originalPending) ? 2000 : 5000,
    (b) => b.status === "cancelled" || b.mediaDeleted,
  );
  const ready = booking?.status === "completed" && !booking.mediaDeleted;
  // Phòng Selfbooth (khổ 20 × 30 máy DS820 hoặc Instax cũ, có tờ in): khách chọn ảnh, làm đẹp, ghép khung và gửi in ngay trên điện thoại.
  const studio = ready && isPolaroidSize(booking.printSize) && Number(booking.prints) > 0;
  const expires = formatDateTime(booking?.mediaExpiresAt);
  return (
    <section className={`page ${ready ? "studio-page" : "narrow"}`}>
      <ErrorBox error={error} />
      {!booking && error && <StudioContact />}
      {!booking && !error && (
        <div className="center" role="status">
          <p>Đang mở album…</p>
          {slow && (
            <p className="soft-note">
              Kết nối đang chậm. Album sẽ tự cập nhật khi có ảnh, bạn không cần tải lại.
            </p>
          )}
        </div>
      )}
      {ready && studio && (
        // Phòng Selfbooth: album như web Selfbooth (đầu trang "Ảnh của bạn", 4 bước Ảnh → Chủ đề → Ghép ảnh → Kết quả).
        <SelfboothAlbum token={token} booking={booking} setBooking={setBooking} reload={reload} />
      )}
      {ready && !studio && (
        <>
          <AlbumViewer token={token} booking={booking} />
          <div className="studio-meta">
            <div className="studio-meta-heading">
              <span className="studio-album-ticket">
                <PiTicketBold aria-hidden="true" /> Vé
                <strong>#{booking.code}</strong>
              </span>
              <span className="studio-album-retention">
                <PiClockBold aria-hidden="true" /> Lưu miễn phí 3 ngày
              </span>
              <Button
                className="outline small studio-album-refresh"
                disabled={refreshing}
                aria-busy={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  await reload();
                  setRefreshing(false);
                }}
              >
                <RefreshCw aria-hidden="true" />{" "}
                {refreshing ? "Đang làm mới…" : "Làm mới ảnh"}
              </Button>
            </div>
            <p>Mỗi ảnh lưu 3 ngày kể từ lúc chụp, sau đó tự xoá. Tải về máy để giữ lâu hơn.</p>
            {expires && (
              <small>
                Ảnh sắp xóa gần nhất: <strong>{expires}</strong>
              </small>
            )}
          </div>
        </>
      )}
      {booking && !ready && (
        <div className="ticket-card">
          <div className="ticket-top">
            <span className={`badge ${booking.status}`}>
              {labels[booking.status]}
            </span>
            <p className="eyebrow">MÃ VÉ CỦA BẠN</p>
            <div className="ticket-code" aria-label={`Mã vé ${booking.code}`}>
              {booking.code}
            </div>
            <dl className="ticket-meta">
              <div>
                <dt>Gói chụp</dt>
                <dd>{booking.packageName}</dd>
              </div>
              <div>
                <dt>Phòng</dt>
                <dd>{booking.roomName || "Phòng trống bất kỳ"}</dd>
              </div>
              <div>
                <dt>Ngày</dt>
                <dd>{formatDate(booking.date)}</dd>
              </div>
            </dl>
          </div>
          <div className="ticket-tear" aria-hidden="true" />
          <div className="ticket-bottom">
            <QRCodeSVG value={window.location.href} size={116} />
            <div>
              <p>
                {booking.mediaDeleted
                  ? "Ảnh đã hết hạn lưu trữ (mỗi ảnh lưu 3 ngày kể từ lúc chụp)."
                  : booking.status === "cancelled"
                    ? "Vé đã được hủy. Vui lòng liên hệ lễ tân nếu cần hỗ trợ."
                    : `Vào phòng chụp và nhập mã này trên máy. Ảnh sẽ hiện tại đây ngay khi bạn chụp xong. Vé gồm ${booking.prints ?? 1} tờ in 10 × 15 cm.`}
              </p>
              {!["completed", "cancelled"].includes(booking.status) && (
                <Button
                  className="outline small"
                  onClick={async () => {
                    if (await reload())
                      toast.info("Đã cập nhật trạng thái vé.");
                  }}
                >
                  <RefreshCw size={14} /> Cập nhật
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
