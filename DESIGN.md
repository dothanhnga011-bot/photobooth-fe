---
name: "Photobooth"
description: "Ảnh nổi bật, thao tác studio rõ ràng, sắc nâu thống nhất."
colors:
  primary: "#4b332a"
  primary-deep: "#34231d"
  primary-soft: "#eee4db"
  porcelain: "#fbf9f5"
  surface: "#ffffff"
  stone: "#eee8df"
  blush: "#f1b7bd"
  blush-hover: "#f8cdd1"
  ink: "#302822"
  muted: "#72665d"
  line: "#dcd3c8"
  booth-bg: "#211a16"
  booth-panel: "#322821"
  booth-line: "#6b5343"
  booth-text: "#f5ece5"
  booth-muted: "#d5c4b6"
  room-ready: "#386147"
  room-shooting: "#805413"
  room-starting: "#315e91"
typography:
  headline:
    {
      fontFamily: '"Be Vietnam Pro", "Segoe UI", sans-serif',
      fontSize: "26px",
      fontWeight: 700,
      lineHeight: 1.35,
      letterSpacing: "-0.025em",
    }
  title:
    {
      fontFamily: '"Be Vietnam Pro", "Segoe UI", sans-serif',
      fontSize: "19px",
      fontWeight: 600,
      lineHeight: 1.4,
      letterSpacing: "-0.02em",
    }
  body:
    {
      fontFamily: '"Be Vietnam Pro", "Segoe UI", sans-serif',
      fontSize: "14px",
      fontWeight: 400,
      lineHeight: 1.6,
    }
  label:
    {
      fontFamily: '"Be Vietnam Pro", "Segoe UI", sans-serif',
      fontSize: "13px",
      fontWeight: 600,
      lineHeight: 1.4,
    }
rounded:
  {
    print: "2px",
    label: "7px",
    control: "10px",
    note: "12px",
    surface: "14px",
    dialog: "16px",
  }
spacing:
  {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "20px",
    xxl: "24px",
    page: "28px",
    wide: "32px",
  }
components:
  button-primary:
    {
      backgroundColor: "{colors.primary}",
      textColor: "{colors.surface}",
      rounded: "{rounded.control}",
      padding: "12px 18px",
    }
  button-primary-hover: { backgroundColor: "{colors.primary-deep}" }
  button-outline:
    {
      backgroundColor: "{colors.surface}",
      textColor: "{colors.primary}",
      rounded: "{rounded.control}",
      padding: "12px 18px",
    }
  input:
    {
      backgroundColor: "{colors.surface}",
      textColor: "{colors.ink}",
      rounded: "{rounded.control}",
    }
  nav-active:
    {
      backgroundColor: "{colors.primary}",
      textColor: "{colors.surface}",
      rounded: "{rounded.control}",
      padding: "11px 12px",
    }
  room-state: { textColor: "{colors.room-ready}" }
  panel:
    {
      backgroundColor: "{colors.surface}",
      textColor: "{colors.ink}",
      rounded: "{rounded.surface}",
      padding: "24px",
    }
  frame-preview:
    {
      backgroundColor: "{colors.stone}",
      rounded: "{rounded.surface}",
      padding: "24px 18px",
    }
  kiosk-key:
    {
      backgroundColor: "{colors.booth-panel}",
      textColor: "{colors.booth-text}",
      rounded: "{rounded.control}",
      height: "58px",
    }
  kiosk-start:
    {
      backgroundColor: "{colors.blush}",
      textColor: "{colors.primary-deep}",
      rounded: "{rounded.control}",
    }
---

# Design System: Photobooth

## Overview

**Creative North Star: "Phòng trưng bày gốm đương đại"**
Ảnh dẫn mắt; nền sứ, đá ấm và espresso giữ phần điều khiển rõ ràng. Album thoáng quanh ảnh; quản trị dùng các vùng nghiệp vụ và bản ghi thẳng hàng.
Hệ được ghi từ giao diện React/CSS đã dựng: đối chiếu `src/styles/polish/professional-foundation.css` và các module `src/styles/{admin,album,entry}/`. Không có raster concept được duyệt làm bản dựng chuẩn.
**Key Characteristics:**

- Ảnh lớn, chữ Việt dễ đọc, trạng thái chọn rõ.
- Cùng ngôn ngữ điều khiển cho quản trị, album và kiosk.
  Logo gốc là `public/logo-m.jpg`: chữ “M.” nâu trên nền kem do người dùng gửi (22/10/2026), chỉ cắt vuông quanh chữ và thu về 1024×1024 để rõ ở cỡ nhỏ, không vẽ lại. Riêng phòng Polaroid có hoa văn lá cuộn vàng cổ do ImageGen tạo; nguồn và prompt ở `src/kiosk/assets/README.md`.

## Colors

Espresso là màu hành động và lựa chọn; espresso đậm dùng khi hover/nhấn. Blush giữ liên hệ với logo và làm nút chính, vòng focus trong kiosk tối.
Porcelain là nền trang, stone là thanh điều hướng và bệ ảnh; surface là vùng làm việc. Ink dùng cho nội dung, muted cho thông tin phụ, line cho ranh giới.
Kiosk có bộ nền/chữ riêng trong frontmatter. Trạng thái phòng giữ xanh lá khi sẵn sàng, hổ phách khi chụp, xanh lam khi bắt đầu; nhãn trạng thái và cảnh báo khác giữ màu ngữ nghĩa hiện có.
Frontmatter là nguồn token chuẩn; dải sắc độ được suy ra trong sidecar chỉ dùng để xem bảng màu.

## Typography

Dùng Be Vietnam Pro cho toàn bộ giao diện; bốn TTF (400/500/600/700) lưu tại `public/fonts/`, nguồn Google Fonts, giấy phép `public/fonts/OFL.txt`, tải bằng `font-display: swap`.
Headline dành cho album; tiêu đề quản trị là 25px/600. Trên điện thoại, tiêu đề quản trị giảm còn 21px, album còn 23px; title dành cho các vùng nghiệp vụ.
Body là chữ chính; đoạn văn có line-height 1.65–1.7. Label dành cho điều khiển; thông tin phụ thường 12px, metadata dày có 11px.
Dùng số tabular cho mã, số ảnh, số lượng và đồng hồ. Ô nhập trên điện thoại dùng 16px.

## Layout

Quản trị: thanh bên 232px, nội dung tối đa 1600px, lề ngang 32px; album: tối đa 1160px, lề ngang 28px. Nhịp phổ biến 8/12/16/20/24/28/32px.
Ở 761–1100px, dashboard quản trị chuyển thành một cột và lề 24px. Từ 760px trở xuống, menu gọn có nút mở, nội dung toàn chiều rộng, lề quản trị 16px và album 20px.
Danh sách nhân viên trên điện thoại dùng bản ghi có nhãn, hiện đủ email, vai trò, trạng thái và thao tác; desktop giữ bảng thẳng hàng.
Lưới ảnh 4 cột, còn 3 cột ở 1000px và 2 cột ở 640px; bộ khung 3 cột, còn 2 cột ở 760px. Ghép ảnh/chỉnh ảnh chuyển từ hai vùng sang một cột ở 760px.
Dock album nằm dưới, chừa 136px cuối trang; ở 640px chừa 168px và cộng safe-area. Trình chỉnh ảnh thành toàn màn hình ở 640px. Kiosk gọn thêm ở 500px; album tinh chỉnh ở 360px.

## Elevation & Depth

**The Depth Rule.** Panel làm việc phẳng, phân vùng bằng nền và đường viền; bóng dành cho lớp nổi, nút đặt trên ảnh và bản in đặt trên bệ.
Dialog quản trị, trình chỉnh ảnh và bản in có bóng riêng được ghi trong sidecar; không thêm bóng vào mọi bản ghi hoặc nút.

## Shapes

Điều khiển bo 10px, thông báo 12px, ảnh/panel 14px, dialog 16px; nhãn nhỏ 7px. Bản in gần vuông (1–2px) để giữ hình dáng tờ ảnh.
**The Selection Rule.** Lựa chọn ảnh/khung/tờ in dùng viền nâu 2px cùng dấu chọn, tim hoặc nhãn trạng thái; giữ ảnh bên trong không bị nhuộm màu thương hiệu.

Ngôi sao trang trí dùng SVG tĩnh 5 cánh, nhỏ khoảng 5–12px, màu hồng phấn và nâu nhạt. Sao gom thành cụm quanh logo quản trị, vùng giới thiệu đăng nhập và đầu trang kiosk; thanh logo album dùng nét mảnh kết hợp sao hai bên. Nền thư viện ảnh và vùng nghiệp vụ để trống, không lặp sao dọc lề. Trang trí không đặt lên ảnh, QR, bảng dữ liệu hay vùng camera, không nhận thao tác và không nhấp nháy.

## Components

### Polaroid · Selfbooth — phương án A đã chọn

Phòng Polaroid dùng `src/styles/entry/kiosk-classic.css`, chỉ bật dưới `data-kiosk-theme="classic"`. Phương án A giữ giấy be, chữ nâu óc chó và góc lá cuộn Pháp cổ. Nền họa tiết thưa, ít tương phản; trang trí đứng sau thao tác, không bắt sự kiện chạm. Một WebP dùng chung cho bốn góc, không tải ảnh trang trí riêng cho từng vị trí.

Playfair Display dùng cho tiêu đề và nhãn thẻ nhập mã; Be Vietnam Pro dùng cho nội dung, phím số, đồng hồ và nút. Phím tối thiểu 46px trên màn ngang thấp; focus có viền rõ. Hai cột nhập mã nằm trong vùng tối đa 1120px, phần giới thiệu bên trái và bàn phím bên phải. Màn nhỏ được cuộn thay vì cắt nút xác nhận.

Màn chụp ngang chia live view 2/3 và cột ảnh 1/3. Cột be có đồng hồ, ảnh mới nhất theo tỷ lệ 3:2, dải ảnh ngang và nút Chụp xong. Nhãn số ảnh nằm dưới ảnh lớn, không che hình; đếm ảnh không hiển thị ký hiệu vô cực. Ảnh xem giữ đủ khung, không đổi tệp gốc hay màu ảnh. Màn đứng giữ cách chia live view trên, ảnh dưới.

### Thành phần dùng chung

Giá gói chụp đặt trực tiếp trên nền thẻ, không bọc bằng khung riêng.
Hàng thứ tự và thao tác của thẻ khung ảnh dùng cùng nền trắng với thân thẻ, không thêm mảng nền riêng.
Ảnh xem trước khung dùng bệ tỉ lệ 3:2, giữ toàn bộ thiết kế bằng object-fit contain. Trạng thái đặt cạnh tên;
thứ tự có nút lên/xuống với vùng bấm tối thiểu 44px. Khung trùng tên cùng bộ thêm số nhận diện ổn định.

Nút chính dùng espresso/chữ trắng; nút phụ trắng/viền line/chữ espresso. Nút chung cao tối thiểu 46px, quản trị 44px; hover đổi nền, disabled giảm opacity còn 0.48.
Ô nhập trắng, viền 1px, bo control; focus đổi viền nâu. Vòng focus dùng nâu espresso 2px cách 3px, gồm nút và ô nhập trong quản trị/đăng nhập; trên nền kiosk dùng blush, ô mã cách 4px.
Điều hướng quản trị đang chọn là nâu đặc/chữ trắng; các bước album dùng gạch dưới và dấu hoàn tất. Menu điện thoại cho phép nhãn dài xuống dòng.
Khung được chọn giữ bệ stone, viền nâu và dấu chọn. Nút trên ảnh, các điều khiển chạm và liên kết thao tác trên điện thoại có vùng bấm tối thiểu 44px.
Ảnh thu nhỏ ở màn hình tối đa 360px cao ít nhất 120px để nút tim và xoá có khoảng trống. Bộ lọc màu trong trình chỉnh ảnh desktop xếp 3 × 2; điện thoại giữ dải cuộn ngang. Thanh gửi in cho phép nhãn dài xuống dòng trong chiều rộng hiện có.

Hộp tạo mã và bán thêm tờ in chia vùng nhập cuộn được với vùng xác nhận thanh toán ở cuối; nút xác nhận vẫn nằm trong khung nhìn khi nội dung dài. Mã vé của hộp bán thêm đặt dưới tiêu đề, đơn giá dưới nhãn tổng tiền. Ô giá in thêm trong cài đặt có số tiền định dạng theo VND bên cạnh, phản ánh chính xác giá trị đang nhập.

Kiosk dùng phím số cao 58px, chữ 24px; nút bắt đầu blush cao tối thiểu 54px. Nhãn trạng thái luôn có chữ đi cùng màu.
Trong buổi chụp, hình trực tiếp ở trên và chỉ ảnh vừa chụp mới nhất ở dưới, không có dải ảnh thu nhỏ. Hai vùng xem dùng toàn chiều rộng màn hình; ảnh phủ kín khung bằng object-fit cover. Hình trực tiếp bỏ 8% mép trên và 12% mép dưới của nguồn HDMI để ẩn dải thông số, rồi phóng đồng đều để phủ kín vùng xem và lật như gương. Cách cắt chỉ áp dụng phần xem trực tiếp, giữ nguyên ảnh lưu; lưới giữa hình cần tắt trên máy ảnh.
Nút bắt đầu nằm trước phần cài đặt nhân viên. Cài đặt kiosk chia nhóm thư mục và camera; phần chi tiết kết nối dài dùng disclosure bản địa, giữ đầy đủ hướng dẫn khi mở.
Máy kiosk Windows có dấu tích nhỏ mở menu Toàn màn hình (F11), Về cửa sổ, Thu xuống taskbar, giữ nguyên trang và phiên chụp. Dấu tích hiện cả khi toàn màn hình lẫn trong cửa sổ; ở chế độ cửa sổ đặt dưới thanh trình duyệt để không che nút đóng. Menu có các hàng cao 44px, tự gọn sau thao tác hoặc khi chuyển sang ứng dụng khác. Thu nhỏ xong mở lại bằng biểu tượng Chrome / Edge ở taskbar; máy dùng bản cũ cần chạy lại file cài.
Dialog đưa focus vào điều khiển phù hợp, giữ Tab/Shift+Tab trong lớp trên cùng, Escape dùng nút đóng hiện có và trả focus khi đóng; tôn trọng trạng thái bận.
Chuyển trạng thái thông thường 160ms ease-out; viền bộ khung/tờ in 180ms. Khi giảm chuyển động, tắt chuyển cảnh và dùng thời lượng gần như tức thì.

## Do's and Don'ts

- **Do** dùng đúng logo gốc, font cục bộ và token frontmatter khi mở rộng giao diện.
- **Do** giữ vùng ảnh rộng, nhãn Việt rõ ràng, dấu chọn và vòng focus nhìn thấy được.
- **Do** kiểm tra lề, dock, menu mở và dialog trên điện thoại.
- **Don't** vẽ lại, thay màu hoặc thêm chữ vào logo.
- **Don't** đổi các trạng thái và cảnh báo ngữ nghĩa thành một màu nâu.
- **Don't** dùng màu hoặc bóng làm tín hiệu duy nhất cho trạng thái chọn.
