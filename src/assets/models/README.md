# Mô hình nhận diện khuôn mặt

`face_landmarker.task` là mô hình Face Landmarker float16, phiên bản 1, do Google MediaPipe phát hành.

Nguồn: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

Tài liệu: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js

Mô hình được đóng gói cùng ứng dụng bằng Vite. WASM dùng trực tiếp từ phiên bản
`@mediapipe/tasks-vision` đã cài trong dự án, để thư viện và runtime luôn tương thích.
Ảnh được nhận diện trong trình duyệt; không gửi ảnh sang dịch vụ Google để xử lý.
