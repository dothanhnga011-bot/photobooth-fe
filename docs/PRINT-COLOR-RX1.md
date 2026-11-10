# Kiểm tra ảnh RX1 sáng gắt hoặc ngả vàng

Phần mềm xuất PNG từ cùng nguồn ảnh và cùng bộ lọc màu của ảnh xem trước. Chương trình in Windows đọc profile màu nhúng và dùng quản lý màu của hàng in. Bản in áp dụng bù tông riêng ở bước gửi giấy bằng gamma 1.30 theo mức đã chọn; ảnh gốc, ảnh ghép QR và file PNG lưu trên web vẫn giữ màu nguồn. Cần so một bản in thật sau khi áp dụng mức mới. Ảnh chụp lại tờ in dưới đèn phòng không đủ để đo sai lệch màu hoặc tự suy ra mức bù vàng/độ bão hòa.

## In nét tối đa, giảm sáng bản in

Mặc định mới của bộ in RX1:

- Chọn mức DPI cao nhất trong danh sách driver thực sự hỗ trợ cho từng lệnh: ưu tiên 600×600 khi có; driver chỉ có 300×600 thì dùng 300×600. Không tự tạo một chế độ DPI không được driver công bố.
- Ảnh từ kiosk đã xuất PNG 2400×3600 px (hoặc 3600×2400 khi nằm ngang), lấy từ ảnh gốc. Nguồn này giữ chi tiết cho bản in chất lượng cao.
- Bù tông bản in bằng **gamma 1.30**: phép thử pixel trên Windows đưa xám 128 về khoảng 104, đậm hơn mức 1.18 (khoảng 113) và 1.25 (khoảng 108); trắng 255 và đen 0 giữ nguyên. Đây là chỉnh tông trước ICM, không tự thay cân bằng trắng hoặc tăng độ bão hòa.

Để phát hành mức mặc định mới trong code, **triển khai bản web mới và cập nhật bộ in trên PC cắm RX1**, rồi khởi động lại chương trình in khi đã hết lệnh đang chờ. Bản mới chấp nhận gamma đến 1.30; bộ in cũ giới hạn 1.25 nên cần cập nhật trước khi đặt 1.30 trong file `rx1-output.json`. File cài máy in tải lại từ Quản lý máy sẽ mang bản chương trình mới. Bộ in đã cài cũng kiểm tra bản cập nhật khi khởi động; chép riêng script mới trước khi web được triển khai có thể bị bộ tự cập nhật thay lại bằng bản đang phát hành.

Sau khi cập nhật, in thử cùng một ảnh. Giữ **ICM**, ICC RX1 hiện có và **Sharpness 0** làm mốc. Nếu cần thử tăng nét bằng driver, chỉ tăng từng nấc sau bản đối chiếu; kiểm tra tóc, mắt và viền sáng quanh khuôn mặt.

Có thể điều chỉnh riêng bản in bằng file `%LOCALAPPDATA%\NXC-Printer\rx1-output.json` trên tài khoản Windows chạy bộ in:

```json
{"gamma": 1.30, "maxResolution": true}
```

`gamma: 1.0` là tông gốc; `1.18` là mức mặc định trước, `1.25` tối hơn và `1.30` là mức mặc định mới đã chọn. Thử từng mức với cùng một ảnh; gamma hợp lệ từ 0.85 đến 1.30. `maxResolution: false` dùng độ phân giải đang đặt trong driver. File này được đọc lại mỗi lần in, không cần sửa cấu hình chứa mã máy in. Cấu hình lỗi sẽ được ghi vào nhật ký và dùng mức mặc định 1.30 / DPI tối đa. Không cộng dồn thêm giảm sáng trong driver khi đang đánh giá mức bù này.

### Áp dụng trên PC cắm RX1 sau khi cập nhật bộ in

Cập nhật bộ in lên bản chấp nhận gamma 1.30 trước; chỉ đổi JSON trên bộ in cũ sẽ bị từ chối và quay về mặc định cũ. Sau đó mở **PowerShell bằng tài khoản Windows đang chạy bộ in**, dán lệnh sau để đặt gamma 1.30 và DPI tối đa:

```powershell
New-Item -ItemType Directory -Path "$env:LOCALAPPDATA\NXC-Printer" -Force | Out-Null
'{"gamma":1.30,"maxResolution":true}' | Set-Content -LiteralPath "$env:LOCALAPPDATA\NXC-Printer\rx1-output.json" -Encoding UTF8
```

Lệnh ghi file bù bản in với hai giá trị trên, không đụng vào `config.json` chứa mã máy. **Lệnh in mới tiếp theo sẽ đọc mức 1.30** trên bộ in đã cập nhật; không cần F5 hoặc mở lại chương trình in để đọc riêng thay đổi JSON này. Tờ đã gửi vào hàng in Windows giữ mức cũ. In thử một tờ của cùng một file, xem dưới ánh sáng trắng ổn định trước khi đổi tiếp. Nhật ký `%LOCALAPPDATA%\NXC-Printer\print-agent.log` phải có dòng `RX1 output: ... gamma 1.3` cho lần in mới.

Nếu đã có `rx1-output.json` đặt gamma 1.07, 1.15 hoặc 1.18, cập nhật chương trình in sẽ vẫn tôn trọng mức đó. Cần sửa file hoặc chạy lệnh trên để áp dụng 1.30. Muốn trở về mức trước, chạy lại lệnh với `1.18`; muốn về tông nguồn, dùng `1.0`.

Hướng dẫn độ phân giải của [driver RX1](https://new.dnpphoto.com/Portals/0/Resources/DS-RX1_PrinterDriverInstruction_For7%2C8%2C10_V1.13_1_English.pdf); API bù tông [Microsoft ImageAttributes.SetGamma](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.imaging.imageattributes.setgamma).

## Profile đã tìm thấy trên PC máy in

Ảnh tab Devices đã xác nhận **DS-RX1** và **DS-RX1 - cat doi 2x6** cùng dùng **RX1-131101 Type-SC (default)**, file **RX1_131101.ICC**, chế độ **Manual** và đã bật **Use my settings**. Chưa thấy lệch ICC giữa hai hàng. Mô tả profile này xuất hiện trong [hướng dẫn Hot Folder Print của DNP, mục ICM cho RX1/HS](https://dnpphoto.com/Portals/0/Resources/HFP_v2.5.3_User_Guide_rev001.pdf); vẫn cần phù hợp giấy đang sử dụng.

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

Luồng **Đơn hàng → In ảnh** dùng chung bộ in RX1 cho in lại và ghép thủ công; file được lưu để xem lại từng tờ. Xem [hướng dẫn in từ đơn hàng](./ORDER-PRINTING.md) về lưu nền, chống trùng và các bản in cũ chưa có file lưu.

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
