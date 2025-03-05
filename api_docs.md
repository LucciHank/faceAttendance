# API Documentation

## 1. Authentication

Tất cả các API endpoints yêu cầu API key được truyền qua header của request.

**Header yêu cầu:**

X-API-Key: your_api_key_here

---

## 2. Endpoints

### 2.1. Đăng ký công ty

**Endpoint:**  
`POST /api/v1/companies`

**Request Body (JSON):**

```json
{
  "company_name": "Tên công ty",
  "admin_username": "admin",
  "admin_password": "password123"
}
Response (JSON):

json

{
  "success": true,
  "company_id": "123",
  "company_code": "COMP001",
  "api_key": "your_api_key"
}
2.2. Đăng ký nhân viên
Endpoint:
POST /api/v1/companies/{company_id}/employees

Path Parameter:

company_id: ID của công ty
Request Body (multipart/form-data):

employee_code: Mã nhân viên
name: Tên nhân viên
position: Chức vụ của nhân viên
registration_video: File video đăng ký khuôn mặt
Response (JSON):

json

{
  "success": true,
  "employee_id": "456",
  "status": "processing"
}
2.3. Chấm công
Endpoint:
POST /api/v1/companies/{company_id}/checkin

Path Parameter:

company_id: ID của công ty
Request Body (multipart/form-data):

image: Ảnh khuôn mặt của nhân viên
location: Vị trí chấm công (tùy chọn)
Response (JSON):

json

{
  "success": true,
  "employee": {
    "id": "456",
    "name": "Nguyễn Văn A",
    "employee_code": "EMP001"
  },
  "attendance": {
    "id": "789",
    "check_in_time": "2024-03-20T08:00:00",
    "status": "checked_in",
    "message": "Chấm công vào ca thành công"
  }
}

2.4. Báo cáo chấm công
Endpoint:
GET /api/v1/companies/{company_id}/attendance/report

Path Parameter:

company_id: ID của công ty
Query Parameters:

start_date: Ngày bắt đầu (định dạng YYYY-MM-DD)
end_date: Ngày kết thúc (định dạng YYYY-MM-DD)
employee_id: ID của nhân viên (tùy chọn)
Response (JSON):

json

{
  "success": true,
  "records": [
    // Danh sách các bản ghi chấm công
  ],
  "statistics": {
    "total_records": 100,
    "employees": {
      // Thống kê theo nhân viên
    },
    "daily_stats": {
      // Thống kê theo ngày
    }
  }
}
3. Error Responses
Tất cả các lỗi sẽ trả về định dạng JSON như sau:

json
{
  "success": false,
  "error": "Mô tả lỗi"
}
4. HTTP Status Codes
200 OK: Thành công
400 Bad Request: Lỗi dữ liệu đầu vào
401 Unauthorized: Chưa xác thực hoặc API key không hợp lệ
404 Not Found: Không tìm thấy tài nguyên
500 Internal Server Error: Lỗi từ phía server