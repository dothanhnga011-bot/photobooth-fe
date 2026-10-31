# Frontend — web nội bộ của tiệm (React + Vite)

Triển khai frontend lên Cloudflare: xem [CLOUDFLARE.md](CLOUDFLARE.md).
Chạy `npm run build:cloudflare` và `npx wrangler@4 deploy`; backend Render và kho R2 giữ nguyên.

Các module được chia theo chức năng trong `src/admin/`, `src/kiosk/`, `src/album/` và
`src/styles/`.

Web chỉ dùng trong tiệm, không có trang giới thiệu hay tra cứu công khai:

| Đường dẫn         | Ai dùng              | Ghi chú                                                                                      |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `/admin`          | Quản trị, lễ tân     | Trang gốc `/` tự chuyển về đây. Tổng quan có bảng phòng trực tiếp + nút “Tạo mã chụp”.       |
| `/kiosk?device=…` | Máy chụp trong phòng | Mở liên kết “Cài kiosk” (Quản trị → Quản lý máy) **một lần**, máy tự nhớ 1 năm.        |
| `/album/<mã>`     | Khách                | Mở bằng mã QR hiện trên máy chụp sau khi chụp xong; lễ tân có thể hiện lại QR ở mục Mã chụp. |

Trang được gắn `noindex` và có `robots.txt` chặn công cụ tìm kiếm.

Kết nối mạng dùng chung trong `src/network.js`: yêu cầu đọc tự thử lại một lần
khi lỗi mạng hoặc máy chủ tạm gián đoạn, trong cùng giới hạn thời gian chờ.
Ảnh tải lên chỉ thử lại với cùng mã ảnh để máy chủ chống trùng; các thao tác
thanh toán, tạo vé và gửi in không bị tự gửi lặp. Sau lỗi liên tiếp, việc làm mới
giãn dần để giảm tải. Đổi Wi-Fi, quay lại tab hoặc mở máy sau chế độ ngủ sẽ
kiểm tra lại bằng yêu cầu thật; trạng thái Wi-Fi của trình duyệt chỉ dùng để gợi ý.
Phiên đăng nhập và bước bắt đầu chụp tự phục hồi sau gián đoạn. Luồng tải ảnh có
giới hạn tổng 90 giây, chuyển sang API nếu R2 không nhận thêm dữ liệu trong
15 giây; vẫn giữ toàn bộ byte của file gốc, không hạ chất lượng để xử lý mạng yếu.

Tải JPEG lên R2 theo dõi số byte thực sự đã truyền: 30 giây không tiến triển thì
hủy đường tải đang treo và lưu qua API, còn tải chậm nhưng vẫn truyền được giữ
ngân sách tối đa 180 giây. Ảnh mới nhất trên kiosk không đổi khi xác nhận lưu ảnh
cũ về sau. Khi rời màn kết quả hoặc đổi khung, các nguồn in tải trước không còn
cần được hủy để nhường mạng và bộ nhớ; nguồn đang được vẽ vẫn hoàn tất bình thường.

Cả trang dùng chung một trạng thái kết nối (`getConnectivity`), lấy từ kết quả thật
của các yêu cầu API: mất mạng, quá thời gian chờ, 502/503/504 (máy chủ đang khởi động lại)
hoặc trang đăng nhập Wi-Fi trả về thay cho API là mất kết nối; mọi câu trả lời khác của
máy chủ là đã kết nối. Trang quản trị chỉ hiện **một** thông báo mất kết nối (các bảng
không báo lặp), tự dò `GET /api/health` (3 → 30 giây, không cache, không bị giới hạn tần
suất) và báo "Đã kết nối lại" rồi tự tải lại dữ liệu. Chuyển cửa sổ chốc lát không tải
lại các bảng; quay lại tab, đổi mạng, mở máy sau khi ngủ thì có. Luồng báo lệnh in mới
tự mở lại khi máy chủ khởi động lại và tải lại hàng chờ để không sót lệnh. Máy chụp hết
giờ lúc mất mạng tự thử chốt phiên giãn dần (không gửi liên tục, báo một lần) rồi hiện QR.

**Giữ máy chủ miễn phí không ngủ:** Render gói free tắt máy chủ sau 15 phút không có yêu cầu,
lần mở sau chờ ~1 phút. Màn máy chụp (`/kiosk`) và trang quản trị (`/admin`) mở suốt ngày trong
tiệm nên tự gọi `GET /api/health` (rất nhẹ, không chạm database) mỗi 8 phút, chỉ trong giờ mở cửa
8h–23h giờ Việt Nam (tiệm mở 9h–23h, giữ thức sớm 1 giờ; `OPEN_HOURS` trong `src/network.js`), nên một
tab bỏ quên qua đêm không giữ máy chủ chạy 24/24 (hạn mức free 750 giờ/tháng; 15 giờ × 31 ngày = 465 giờ). Đóng hết các màn này hoặc ngoài
giờ mở cửa thì máy chủ vẫn ngủ như cũ, màn đầu tiên mở trong ngày sẽ đánh thức nó. Cần giữ thức
ngoài các màn này thì dùng dịch vụ ping ngoài (UptimeRobot, cron-job.org) gọi cùng địa chỉ.

Lễ tân có mục **Quản lý máy**: chọn phòng đang hoạt động → **Cài kiosk** →
**Mở kiosk** trên máy tính trong phòng. Lễ tân cũng có thể sao chép liên kết, quét QR
hoặc tải file cài tự mở cho Windows/Mac. Thêm, sửa và ngừng phòng do quản trị viên quản lý.
Quyền này dùng tài khoản lễ tân hiện có; không cần đổi vai trò tài khoản.

Album của khách (`src/album/AlbumViewer.jsx`) chỉ để xem và tải, giống Snapbox: ảnh lớn ở giữa,
dải ảnh nhỏ bên dưới gồm ảnh đã ghép khung, video tua nhanh rồi tới các ảnh gốc. **Lưu ảnh / Lưu
video** lưu tệp đang xem, **Lưu tất cả** lưu cả album vào thư viện ảnh (`src/album/save-to-phone.js`):
iPhone mở bảng chia sẻ của iOS ("Lưu N mục" → app Ảnh; video WebM không lưu được vào Ảnh nên không
kèm), Android / máy tính tải từng tệp. Chọn ảnh, ghép khung và in đều làm ở máy chụp. Album tự làm
mới 10 giây/lần trong lúc chụp để nhận ảnh đồng bộ muộn, 60 giây/lần khi đã chụp xong; nút **Làm mới
ảnh** cập nhật ngay. Giao diện dùng nâu espresso **#4b332a** trên nền kem sáng.

Màn chọn ảnh của máy chụp (150 giây) có 3 mục bên cạnh khung xem trước:

- **Chọn ảnh**: chọn đủ số ảnh của gói. Khi đã đủ, máy tự mở mục **Màu ảnh**.
- **Màu ảnh**: filter từ **Quản lý filter** (gồm "Gốc", filter của tiệm, rồi bộ lọc có sẵn đang bật), áp cho **tất cả ảnh** hoặc **từng ảnh**: chọn số ảnh ở hàng "Áp dụng cho" hoặc chạm vào ảnh trên khung. Chọn màu cho "Tất cả ảnh" sẽ bỏ màu riêng của từng ảnh.
- **Nhãn dán**: chỉ các nhãn dán tiệm tải lên ở **Thiết lập → Nhãn dán** (chưa có nhãn dán nào thì mục này ẩn). Khách kéo nhãn dán trên khung, chụm/mở 2 ngón hoặc bấm **Nhỏ hơn / To hơn** để đổi cỡ.

Màu chỉ áp lên ô ảnh, không áp lên nền khung, mã QR và nhãn dán. Ảnh ở màn QR, ảnh ghép trong album và tờ in vẽ cùng một cách (`src/kiosk/decor.js`).
Khung khổ nhỏ có 2 dải giống nhau trên một tờ thì nhãn dán tự lặp sang dải thứ hai, để 2 dải cắt ra giống nhau.
Lựa chọn được lưu cùng phiên chụp, nên tải lại trang vẫn giữ.

Quản trị khung: ảnh xem trước gọn hơn, nút **↑ / ↓** lưu thứ tự ngay trong bộ mà không mở hộp sửa.
Xóa từ khóa và chọn tất cả trạng thái để sắp xếp toàn bộ; vẫn lọc được theo chủ đề.
Khung trùng tên cùng bộ có nhãn `pink · 01`, `pink · 02` ổn định qua lọc/sắp xếp;
tên gốc được giữ trong dữ liệu. Tổng ô ảnh của bộ chỉ tính khung đang dùng.

Trong **Dung lượng ảnh → Trợ lí Minh** (mục cuối của menu, cũng mở từ cảnh báo dung lượng), kho ảnh R2 nằm trước phần dữ liệu MongoDB
Atlas; hai kho có dung lượng và mức theo dõi riêng. Phần **Hạn lưu ảnh & dọn dẹp**
hiển thị hạn ảnh gần nhất, dung lượng file đã hết hạn và lý do chưa thể dọn.
Số liệu cập nhật mỗi 30 giây; **Làm mới** lấy lại ngay. Thời điểm cập nhật và trạng
thái **Số liệu cũ** nằm cạnh tiêu đề. Mở **Chi tiết ảnh đang lưu** để xem dung lượng
từng loại file. Giới hạn của hai kho được hiển thị theo cấu hình hiện có của backend;
trang không có ô điều chỉnh hay nút lưu/bỏ giới hạn.
Mọi trang quản trị cùng theo dõi dung lượng: cảnh báo vàng từ **80%**, đỏ từ
**90%**, kèm số MB còn lại. Nút **Mở trợ lí để dọn ảnh** mở thẳng mục trợ lí.
Cảnh báo tự cập nhật mỗi 30 giây khi web đang hiển thị; sau khi dọn,
số liệu dùng chung được cập nhật ngay. Khi mất kết nối, cảnh báo cũ
vẫn hiện và ghi rõ **Số liệu cũ**.
Trong Hàng chờ in, **Ảnh sắp xoá gần nhất** lấy hạn sớm nhất của ảnh đang lưu
(ảnh chụp, ảnh gốc tải lên và ảnh in ở mọi trạng thái), không phụ thuộc tab Chờ in
hay Đã in. Ảnh đã hết hạn nhưng chưa tới lượt dọn hiện **Đã hết hạn, chờ dọn**.
Quản trị viên có thể **Dọn ảnh đã hết hạn** theo thời gian lưu hiện tại hoặc mở
**Xem lệnh đã in** để chọn lệnh muốn xóa. Không tự dọn ảnh còn hạn khi mở mục này.

Giới hạn mặc định **512 MB** theo gói MongoDB Atlas đã xác nhận của studio;
backend đọc mức đã cấu hình, mặc định từ `MEDIA_STORAGE_LIMIT_MB`. Số MB đã dùng lấy từ lệnh
[`atlasSize`](https://www.mongodb.com/docs/atlas/free-tier-commands/), bao gồm dữ liệu
và chỉ mục của mọi database trong cluster. Số còn lại = giới hạn − tổng đã dùng.
MB ở đây = 1.024 × 1.024 byte.

Nếu MongoDB không hỗ trợ hoặc không cho phép đọc dung lượng cluster, trang vẫn
báo MB file ảnh và database ứng dụng, còn số MB trống ghi rõ chưa đo được.
Nếu backend chưa có giới hạn, trang giữ số liệu đã dùng và báo chưa tính được dung lượng còn lại.

```bash
cd photobooth-fe
npm ci
npm run dev
```

Mở http://localhost:5173/admin. Backend cần chạy tại http://localhost:8080.
Đổi địa chỉ backend bằng cách tạo `.env` từ `.env.example` và sửa `API_PROXY_TARGET`.

Ảnh khách có thể lưu trong Cloudflare R2 qua backend; cấu hình theo
[R2_SETUP.md](../photobooth-be/R2_SETUP.md), không đặt khóa trong frontend hoặc biến `VITE_*`.
Dải ảnh nhỏ gọi `?size=thumbnail`; nút tải lấy ảnh đầy đủ.
Ảnh cũ không có thumbnail được backend trả ảnh đầy đủ. **Trợ lí Minh** theo dõi riêng
MongoDB và kho R2, cảnh báo mức 80/90% và báo chưa biết khi kho R2 không đo được.
Giao diện theo dõi R2 nằm trong `src/admin/r2-storage.jsx`; warning dùng chung toàn admin,
monitor vẫn chỉ gọi một API `/admin/storage` mỗi 30 giây. Mức R2 bằng GB thập phân là
mức theo dõi dung lượng hiện tại, không phải hóa đơn GB-tháng hoặc giới hạn cứng.
Mức mặc định lấy từ `R2_STORAGE_LIMIT_GB` của backend (10 GB); bỏ form điều chỉnh
không thay đổi mức đã lưu hay cấu hình kho ảnh.
Phần MongoDB nằm trong `src/admin/mongo-storage.jsx`; dọn/đếm ngược trong
`src/admin/storage-lifecycle.jsx`; các thành phần hiển thị dùng chung trong `storage-ui.jsx`.
`storage-retention.js` dùng chung hạn ảnh giữa trợ lí và hai tab in. Giao diện tổng
thể nằm trong `src/styles/admin/storage-assistant-overview.css`.
Không đặt MONGO_URI hoặc JWT_SECRET trong frontend.

```bash
npm run build
npm run preview
```

`npm test` chạy các test đơn vị. Test trên trình duyệt chạy bằng `node test/<tên>.browser.mjs`
(cần build trước và repo `photobooth-be` đã cài dependencies nằm cạnh repo này).

Build nằm trong `dist/`. Bản chạy thật ở Cloudflare Workers (https://studio.selfbooth.workers.dev):
`cloudflare/worker.js` chuyển tiếp `/api/*` tới backend, Static Assets trả `index.html` cho các route
React. Cách triển khai và cấu hình: `CLOUDFLARE.md`.

Máy chụp: nên mở trình duyệt ở chế độ toàn màn hình (nút “Bật / tắt toàn màn hình” trong
“Cài đặt máy chụp (nhân viên)” ở màn chờ) và cho phép dùng camera.

Một web, hai **loại phòng**. Đầu ca, nhân viên mở máy chụp từng phòng ở Quản trị → Quản lý máy →
**Cài máy chụp** (lấy liên kết / QR). Loại phòng chọn lúc thêm phòng.

- **Photobooth** (máy ảnh **Fujifilm X-S10 / X-S20 / X-T3** + FUJIFILM X Acquire + dây bấm, in ở máy DNP DS-RX1):
  Chạm để bắt đầu → **Chọn cách thanh toán**.
  - **Nhập mã**: khách chuyển khoản tại quầy, nhân viên tạo mã 6 số → nhập mã → vào màn chụp luôn;
    gói và số bản in lấy từ mã.
  - **Tiền mặt**: chọn loại tờ (tờ bé / tờ to) → chọn số lượng → màn đọc tiền. Mỗi tờ tiền máy nhận
    được cộng ngay trên màn hình; đủ tiền là vào màn chụp. Chưa lắp máy đọc tiền thì bật “Chế độ
    thử tiền mặt” trong hộp Cài máy chụp để thử bằng nút giả lập.
- **Polaroid** (máy ảnh Fujifilm + FUJIFILM X Acquire + **dây bấm** như phòng Photobooth, in ở máy
  **Instax Link WIDE** qua print agent — xem README của `photobooth-be`):
  Chạm để bắt đầu → **Chọn layout** (lưới thẻ: hình layout, số ảnh, giá) → thông báo “Chọn layout này, vào chụp
  nha!” → khách bấm dây chụp (không đếm ngược, tối đa số lần chụp của layout) → chọn ảnh & khung → in Instax.
  Khách **trả tiền ở quầy**: đơn ghi “Polaroid · chưa thu tiền”, nhân viên bấm “Đã thu tiền mặt / chuyển
  khoản” ở Đơn hàng. Layout là các gói khổ Instax ở Khổ ảnh & bảng giá → tab **Polaroid** (số ảnh trong layout
  chọn bằng hình, giá, số lần chụp tối đa); nút **Tạo 6 layout mẫu** tạo layout 1–6 ảnh (5 ảnh = 2 to trái + 3 bé
  phải, `src/polaroid-layouts.js`) kèm khung trắng. Khung Instax là thẻ Instax Wide ngang 1800 × 1200, mỗi tấm
  in 1260 × 840.

Khổ ảnh & bảng giá và Chủ đề có 2 nút chuyển **Photobooth / Polaroid** để chỉnh riêng từng loại hình: gói khổ
nhỏ / khổ to và giá in thêm tờ 10 × 15 ở tab Photobooth; layout và giá in thêm Instax ở tab Polaroid. Chủ đề
lưu loại hình (chủ đề cũ theo khung bên trong: có khung Instax là Polaroid); ở Khung ảnh, khung Size Instax chỉ
gán được vào chủ đề Polaroid và ngược lại. Không còn chế độ tự chụp theo đếm ngược (Canon R100): mọi phòng chụp
bằng dây bấm; `scripts/canon-camera` (Canon Camera Agent) không còn được máy chụp dùng.

Mọi chữ chính trên màn hình máy chụp (tiêu đề, nút, thông báo chọn layout…) sửa ở Thiết lập →
**Chữ trên máy chụp**; ô để trống dùng chữ mặc định (`src/kiosk/kiosk-texts.js`).

Số bản in đếm theo tờ khách cầm trên tay, tối thiểu 2 tờ: khổ nhỏ là 1 tờ 10 × 15 cắt đôi
(= 2 tờ nhỏ, mỗi lần bấm + thêm 2 tờ nhỏ), khổ to tối thiểu 2 tờ. Gói đã kèm số tờ ghi trong
Quản trị → Khổ ảnh & bảng giá; tờ thêm cộng theo “Giá in thêm”. Máy chủ tính lại tổng tiền khi
mở lượt chụp (`/api/kiosk/sale`).

## Fujifilm X-T3 / X-S10 / X-S20: chụp bằng dây bấm

Kiosk nhận JPEG từ thư mục trên máy tính khi khách bấm dây remote. USB dùng để truyền ảnh qua
FUJIFILM X Acquire; micro-HDMI + thẻ ghi hình USB dùng cho hình xem trước. Kiosk không bật nguồn
máy ảnh và không phát lệnh chụp. Khi khách nhập mã chụp đã thanh toán ở quầy (hoặc đút đủ tiền
mặt), phần mềm mở lượt chụp, sau đó khách bấm dây để chụp.

[Hướng dẫn Fujifilm X-T3](https://fujifilm-dsc.com/en/manual/x-t3/connections/computer/index.html)
và [bảng tương thích X Acquire](https://www.fujifilm-x.com/en-gb/support/compatibility/software/x-acquire/)
xác nhận ba máy này có thể chụp tether. X-S10 cần firmware từ 2.00 để có tether qua USB
([thông báo Fujifilm](https://www.fujifilm-x.com/en-us/news/latest-firmware-update-for-the-fujifilm-x-s10-ver-2-00-announced/)).
Phần mềm chỉ cần tính năng tự tải JPEG xuống thư mục; các chức năng điều khiển nâng cao phụ thuộc
phiên bản và phần mềm Fujifilm đang cài, nên cần thử trên đúng máy ảnh.

### Cài một lần trên máy Windows trong phòng

1. Máy kiosk hiện đã cài **FUJIFILM X Acquire 1.29**. Trên máy khác, cài
   [X Acquire chính hãng](https://www.fujifilm-x.com/global/support/download/software/x-acquire/).
   Không chạy gPhoto2/darktable cùng lúc với X Acquire; không đổi driver USB của Fujifilm bằng
   Zadig khi dùng ứng dụng chính hãng.
2. Trên máy ảnh, chọn **IMAGE QUALITY: FINE** hoặc **FINE + RAW**; X-S20 chọn thêm
   **SELECT JPEG/HEIF: JPEG**. Chọn **Single shooting**, tắt
   self-timer; đặt **POWER MANAGEMENT → AUTO POWER OFF: OFF**. X-T3/X-S10: chọn **SET UP →
   CONNECTION SETTING → CONNECTION MODE → USB TETHER SHOOTING AUTO**. X-S20: chọn
   **NETWORK/USB SETTING → CONNECTION MODE → USB TETHER SHOOTING AUTO** và đặt
   **USB POWER SUPPLY/COMM SETTING** thành **AUTO** hoặc **POWER SUPPLY OFF/COMM ON**.
   Không dùng **USB CARD READER**, **USB WEBCAM**
   hoặc **USB TETHER SHOOTING FIXED** cho quy trình thử đầu tiên. Ở chế độ FIXED, ảnh có thể
   không được ghi vào thẻ khi cáp USB ngắt
   ([hướng dẫn X-S10](https://fujifilm-dsc.com/en/manual/x-s10/connections/computer/index.html)).
3. Cắm cáp USB dữ liệu từ máy ảnh vào PC. Bấm biểu tượng **X Acquire** trong khay hệ thống
   Windows → **Preferences…** để chọn thư mục tải là `C:\PhotoBooth\Fujifilm` và trong
   **File Type** chọn nhận JPEG. Tạo thư mục này nếu chưa có. Chụp thử bằng nút trên thân máy và
   xác nhận JPEG mới xuất hiện trên PC trước khi kết nối kiosk.
   Theo [hướng dẫn X Acquire của Fujifilm](https://www.fujifilm-x.com/pt-br/stories/fujifilm-x-acquire-features-users-guide/),
   ảnh ở chế độ tether mặc định được lưu trên PC; cần sao lưu thư mục ảnh định kỳ và không rút USB
   khi còn ảnh đang chờ truyền.
4. Dây bấm cần tương thích remote Fujifilm RR-100. X-T3 dùng đầu remote 2,5 mm. X-S10 và X-S20
   dùng cổng mic/remote 3,5 mm; dây RR-100 2,5 mm cần **đầu chuyển 2,5 mm cái → 3,5 mm đực,
   3 cực cho remote**. Chọn **REMOTE** khi máy hỏi MIC/REMOTE
   ([Fujifilm RR-100](https://www.fujifilm-x.com/global/products/accessories/rr-100/)).
   Dây Canon RS-60E3 hiện có chưa được xác nhận tương thích điện với Fujifilm; thử trên máy thật
   trước khi cho khách sử dụng.
5. Trong **đúng cửa sổ Chrome kiosk**, vào **Cài đặt máy chụp → Chọn thư mục ảnh**, chọn
   `C:\PhotoBooth\Fujifilm`, cấp quyền đọc. Nếu Chrome hỏi, chọn **Cho phép mỗi lần truy cập**
   để lần đăng nhập sau tự đọc được thư mục. Chọn thẻ HDMI (thường tên **USB Video**) làm hình
   xem trước. Bấm **Thử nhận ảnh từ máy ảnh**, rồi bấm dây; chỉ đón khách khi JPEG thử hiện
   trong kiosk.

### Mỗi sáng

Nhân viên bật PC, đăng nhập Windows, kiểm tra máy Fujifilm ON và cáp USB/HDMI/dây bấm, sau đó
kiểm tra FUJIFILM X Acquire đã kết nối, Chrome mở kiosk và chụp thử một tấm. Windows Startup
chỉ chạy sau khi đăng nhập; trước khi mở X Acquire, tác vụ này đặt thư mục lưu ảnh về
`C:\PhotoBooth\Fujifilm`. Máy nhận tiền cần được cài đúng cổng/giao thức; khi chưa lắp máy nhận
tiền, bật chế độ thử của phòng để thử luồng tiền mặt bằng các nút giả lập (không tính doanh thu).

X-T3, X-S10 và X-S20 dùng cùng phần mềm và thư mục ảnh trong kiosk; khi đổi thân máy, kiểm tra
lại chế độ USB tether, đầu dây remote, hình HDMI và chụp thử. Việc dây bấm, USB, HDMI và flash
hoạt động cùng lúc trên từng máy cần xác nhận bằng ảnh chụp thực tế.
## Giao diện: Tailwind CSS 4

`src/tailwind.css` là file CSS duy nhất được nạp (trong `main.jsx`), qua plugin `@tailwindcss/vite`.

- Class Tailwind có **tiền tố `tw:`** (vd. `tw:flex tw:gap-2 tw:hover:bg-brand`) để không trùng các class sẵn có
  như `.outline`, `.small`, `.panel`.
- **Không bật preflight** (reset mặc định của Tailwind): kiểu chữ, nút… của các màn cũ giữ nguyên.
- CSS cũ (`style.css`, `theme.css`, `self-booth.css`, `polish.css`, `motion.css`) nằm trong lớp `legacy`, thấp hơn
  `components` và `utilities` — class Tailwind luôn ghi đè được CSS cũ.
- Màu thương hiệu: `brand`, `brand-dark`, `brand-soft`, `ink`, `muted`, `line`, `cream` (vd. `tw:text-brand`).
- `src/admin-ui.css`: giao diện trang quản trị & đăng nhập viết bằng `@apply` (chỉ trong `.admin-shell` /
  `.admin-login`); máy chụp và album của khách giữ thiết kế riêng.

Danh mục gói chụp và khung ảnh được tách để dễ chỉnh sửa:

- `src/admin/catalog-toolbar.jsx`: tìm kiếm không dấu, lọc trạng thái và chủ đề.
- `src/admin/package-catalog.jsx`: thẻ gói chụp, giá và quyền lợi.
- `src/admin/frames.jsx`: thư viện khung, nhóm chủ đề và ảnh xem trước.
- `src/admin/resource-editor.jsx`: form thêm/sửa và xem trước gói chụp.
- `src/styles/admin/catalogs.css`: giao diện hiện tại của các danh mục.
  Các module `src/styles/polish/{catalog-controls,package-catalog}.css`
  là cấu trúc nền, được import trước hệ giao diện hiện tại.

Chạy `node test/admin-catalog.browser.mjs` để kiểm tra tìm/lọc, thêm/sửa/xoá và bố cục máy tính/điện thoại.
Bài kiểm tra dùng dữ liệu mẫu và API giả, không tác động dữ liệu thật.

Màu giao diện hiện tại được đặt ở `src/styles/polish/professional-foundation.css`;
`src/tailwind.css` ánh xạ cùng bảng màu cho các class `tw:`. Các file `legacy` là lớp nền tương thích.

Giao diện được hoàn thiện trong bốn file riêng, nạp cuối `tailwind.css`:

- `src/styles/polish/professional-foundation.css`: chữ, nút, thông báo và hướng dẫn dùng chung.
- `src/styles/polish/professional-entry.css`: đăng nhập, nhập mã, màn chụp và QR nhận ảnh.
- `src/styles/polish/professional-admin.css`: bố cục, bảng, gói/khung, hàng in và dung lượng.
- `src/styles/polish/professional-album.css`: thông tin vé và trang xem, tải ảnh.

Ba file entry/admin/album ở trên là **index import**; CSS thực tế được chia tại:

- `src/styles/entry/{login,kiosk}.css`.
- `src/styles/admin/{workspace,operations,controls,catalogs,forms,printing-and-storage,responsive}.css`.
- `src/styles/album/{workspace,responsive}.css`.

Logo dùng ảnh gốc ở `public/logo-m.jpg`, hiển thị qua `Brand` trong `src/studio.jsx`;
kích thước theo màn hình ở `src/styles/polish/brand-logo.css`. Hướng dẫn bắt đầu thu gọn
và vẫn nhớ trạng thái mở/đóng mà nhân viên đã chọn trên từng máy.

Thiết kế lại bằng [Impeccable](https://github.com/pbakaus/impeccable): nâu espresso,
nền porcelain, menu quản trị màu stone và điểm nhấn hồng từ logo. Font Be Vietnam Pro
được lưu tại `public/fonts` (kèm giấy phép OFL), không cần gọi dịch vụ font bên ngoài.

`src/main.jsx` tải riêng ba nhánh quản trị, kiosk và album bằng `React.lazy`.
Trang quản trị và máy chụp không tải module giao diện album trước khi cần;
trạng thái chờ tải dùng chung `Suspense` hiện có.

- `PRODUCT.md`: chức năng và ràng buộc sản phẩm cần giữ.
- `DESIGN.md` và `.impeccable/design.json`: hệ thiết kế từ giao diện đã hoàn thiện.
- `.impeccable/surfaces/src-main-jsx.md`: phạm vi và hướng bố cục lần thiết kế lại này.
- `.agents/skills/impeccable`: skill và giấy phép gốc, cài riêng cho dự án; Codex có thể
  nhận diện sau khi mở lại phiên. Dùng `$impeccable` cho các lần sửa sau.

Các màn cùng dùng nút, ô nhập và trạng thái chọn nhất quán. Sửa các module giao diện
trên thay vì thêm một lớp CSS ghi đè khác. Ảnh review và trạng thái chạy Impeccable được
gitignore; dữ liệu giả trong bài kiểm tra không tác động album/khách thật.

`src/dialog-focus.jsx`, nạp qua `ToastProvider` trong `src/studio.jsx`, quản lý bàn phím
cho hộp thoại: đưa focus vào form, giữ Tab trong hộp thoại trên cùng, Escape dùng nút
đóng hiện có và trả focus về nút mở. Quy tắc khóa nút khi đang xử lý vẫn do component
nghiệp vụ quyết định.
