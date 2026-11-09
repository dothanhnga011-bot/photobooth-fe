# Kiểm tra ảnh RX1 sáng gắt hoặc ngả vàng

Phần mềm xuất PNG từ cùng nguồn ảnh và cùng bộ lọc màu của ảnh xem trước. Đã bỏ bước tăng nét riêng trên bản in. Chương trình in Windows đọc profile màu nhúng và dùng quản lý màu của hàng in. Thay đổi này không tự hiệu chuẩn màn hình, driver hay giấy; cần so một bản in thật sau khi triển khai.

## Profile đã tìm thấy trên PC máy in

Danh sách được cung cấp có **RX1-131101 Type-SC**, tên file **RX1_131101.ICC**. Mô tả RX1-131101 Type-SC xuất hiện trong [hướng dẫn Hot Folder Print của DNP, mục ICM cho RX1/HS](https://dnpphoto.com/Portals/0/Resources/HFP_v2.5.3_User_Guide_rev001.pdf). Đây là profile RX1 đã có sẵn để đối chiếu, cần phù hợp giấy đang sử dụng. Danh sách profile đã cài chưa xác nhận profile đang được gán mặc định cho hàng in.

Thực hiện trên PC cắm RX1, bằng tài khoản Windows đang chạy kiosk:

1. Color Management → **Devices** → Device = **DS-RX1**.
2. Bật **Use my settings for this device**. Trong danh sách profile gán cho thiết bị, chọn **RX1-131101 Type-SC / RX1_131101.ICC**. Nếu chưa có, bấm **Add** rồi chọn profile này trong danh sách đã cài.
3. Bấm **Set as Default Profile**, kiểm tra có chữ **(default)** cạnh profile RX1.
4. Chọn Device = **DS-RX1 - cat doi 2x6**, làm lại bước 2–3 để cả hai hàng dùng cùng profile cho cùng máy và giấy.
5. Ở cả Printing Preferences và Printing Defaults, kiểm tra **ICM**, Intent **Pictures**, Sharpness **0**. In cùng một ảnh qua kiosk với màu **Gốc**, so tờ to và tờ cắt đôi dưới cùng ánh sáng.

Các profile **sRGB IEC61966-2.1**, **sRGB Color Space Profile** và **Agfa: Swop Standard / RSWOP.icm** không phải profile đầu ra RX1 cần chọn trong bước này. Thiết lập JPEG trên máy ảnh vẫn để **sRGB**.

Nếu RX1_131101.ICC đã là mặc định trên cả hai hàng, giữ nguyên profile đó làm mốc in thử; chưa có cơ sở kết luận ICC đang sai hoặc tự chuyển sang một profile RX1 khác. Nếu cả hai tờ vẫn sáng gắt/ngả vàng, đối chiếu file PNG đã in, loại giấy/profile tương ứng và thiết lập màu riêng của driver theo các phần dưới.

## Đồng bộ ICM trên PC cắm RX1

Trong **Quản trị → Quản lý máy → Cài máy chụp → Máy in DNP**, tải **Đồng bộ màu RX1 (Windows)**. Hoặc dùng file `downloads/cai-mau-RX1.bat` trong bản build. Chép file sang PC đang cắm RX1 và chạy bằng tài khoản Windows đang dùng kiosk; Windows hỏi quyền quản trị thì cho phép. Đợi các lệnh đang in hoàn tất trước khi chạy.

Công cụ đặt **System ICM / Pictures / Color** cho cả **Printing Defaults** và **Printing Preferences** hiện có của các hàng dùng driver RX1. Công cụ kiểm tra để giữ độ phân giải, giấy, chế độ cắt và bề mặt theo từng hàng. Cấu hình được sao lưu trước khi sửa tại `%LOCALAPPDATA%\NXC-Printer\color-backups\<thời điểm>\color-settings.json`; lỗi lưu hoặc driver không giữ thiết lập sẽ kích hoạt khôi phục. Nếu Windows không cho phép khôi phục, lỗi sẽ kèm vị trí bản sao lưu.

Công cụ này chỉ đồng bộ ICM, không tự gán hoặc đổi ICC. Sau khi chạy, đặt/kiểm tra profile ở **Devices** theo phần trên và in cùng một ảnh qua kiosk ở chế độ màu **Gốc** để đối chiếu.

Có thể chạy PowerShell trực tiếp:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\configure-rx1-color.ps1"
# Khôi phục bằng đường dẫn thư mục sao lưu đã được công cụ in ra:
powershell -NoProfile -ExecutionPolicy Bypass -File ".\configure-rx1-color.ps1" -RestoreBackup "C:\duong-dan\color-backups\thoi-diem"
```

Script cũ `scripts/configure-rx1-quality.ps1` chuyển tiếp sang cùng công cụ này, không còn ép 600×600 dpi.

## Khoanh vùng bằng đúng file đã in

1. Tại Quản trị, tải **file PNG của lệnh in** và mở trên cùng màn hình đang dùng để so màu. Không dùng JPEG gốc hoặc bản xem nhanh thay cho file đã in.
2. Nếu PNG cũng sáng gắt/ngả vàng, kiểm tra bộ lọc khách đã chọn, ảnh nguồn và cài đặt màu của màn hình.
3. Nếu khác biệt chủ yếu xuất hiện trên giấy, kiểm tra ICC/ICM của hàng in và xem bản in trong ánh sáng trắng ổn định. Giữ nguyên một file và điều kiện xem khi in thử.

## Kiểm tra cả hai hàng in

Mở Printing Preferences của **DS-RX1** và **DS-RX1 - cat doi 2x6**:

- Option: Color Adjustment = **ICM**, Sharpness = **0** làm mốc đối chiếu.
- Advanced: ICM do hệ thống quản lý; Intent = **Pictures**.
- Printer properties → Color Management → Color Management… → tab **Devices**: chọn đúng hàng in trong danh sách Device, xem profile nào được gán và profile nào là mặc định. Tab **All Profiles** chỉ liệt kê profile đã cài toàn hệ thống, không cho biết profile đang gán cho RX1.
- Kiểm tra profile RX1 tương ứng với driver/media đang dùng. 300×300 dpi là chế độ đang thấy trong ảnh cấu hình; tăng độ phân giải không tự xử lý sáng gắt hay ám vàng.

Làm tương tự tại **Printer properties → Advanced → Printing Defaults** của cả hai hàng. Preferences là cấu hình theo tài khoản và có thể ghi đè Defaults. Trong tab Option, chọn **ICM** làm mốc so màu; kiểm tra Sharpness = **0**. Cấu hình riêng của DNP trên tab Color Adjustment cần xem trong cửa sổ driver, vì không phải mọi tùy chọn riêng đều có trong PrintTicket.

Nếu mục Devices không có profile RX1, cài lại driver hoặc lấy profile từ [trang tải DNP](https://www.dnpphoto.com/downloads), đúng mẫu RX1/RX1HS và loại giấy. Trong **Devices**, chọn đúng từng hàng → bật **Use my settings for this device** nếu cần → **Add** profile tương ứng → **Set as Default Profile**. Các mục “sRGB virtual device model”, “WCS” trong ảnh All Profiles không xác nhận profile đầu ra của máy in. Thiết lập JPEG trên máy ảnh là **sRGB**; profile máy in vẫn phải là RX1/media.

Không suy ra profile đúng chỉ từ việc nút ICM đã bật. Không đồng thời thay nhiều chỉ số sáng/màu khi chưa có mẫu đối chiếu. Bộ cài mới sao chép thiết lập driver từ hàng chính khi tạo hàng cắt đôi mới; hàng đã tồn tại giữ cấu hình hiện có.

## Đọc chẩn đoán mà không in hoặc sửa cấu hình

Sau khi cập nhật chương trình in trên PC cắm RX1, chạy PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\NXC-Printer\print-agent.ps1" -Diagnose
```

Kết quả gồm tên hàng in, khổ giấy, ICM/độ phân giải của cả Defaults và Preferences, cùng đường dẫn ICC Windows báo cho hàng in. Gửi kết quả cùng file PNG và ảnh bản in để đối chiếu. Nếu chưa có RX1 trên PC, công cụ chỉ báo không tìm thấy máy in.

Tài liệu driver DNP: [DS-RX1, các chế độ ICM và giá trị mặc định](https://dnpphoto.com/Portals/0/Resources/DSRX1HS_PrinterDriverGuide_For7%2C8%2C10_V1.13_English.pdf).

Đối chiếu thêm: [DNP về Preferences và Defaults](https://www.dnpphoto.com/Portals/0/Resources/DNP_Printers_BasicColorManagement.pdf), [DNP về gán profile ICC](https://dnpphoto.com/Portals/0/Resources/DNP_Printer_Multi_OS_ICM_Update_March_2014.pdf), [Microsoft về PageColorManagement và ICM](https://learn.microsoft.com/en-us/windows/win32/printdocs/color-management-and-the-print-schema).
