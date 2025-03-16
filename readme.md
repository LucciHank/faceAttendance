Mở thư mục khác rồi chạy các câu lệnh sau:
- Tạo môi trường ảo: python -m venv myenv
- Chạy install: pip install -r requirements.txt
- Chạy server: python app.py

ai.py: hàm xử lí mô hình ai, bao gồm detect_face (phát hiện mặt và trả về tọa độ), predict (dự đoán mặt) và train (huấn luyện)

models.py: định nghĩa các class có trong db và kết nối db

camera.py: hàm stream frame của cv2 lên web

api.py: chứa các hàm api không trả về giao diện mà trả về kết quả json: toàn bộ api này có địa chỉ là /api/<tên route>

app.py: định nghĩa biến toàn cục, tự khởi tạo các bảng, định nghĩa các route trả về giao diện