from flask import Flask, Response, render_template, jsonify, request, url_for, send_file, redirect, session, flash
import cv2
import time
import threading
import os
from gtts import gTTS
from io import BytesIO
import mediapipe as mp
import numpy as np
from datetime import datetime, timedelta
import sqlite3
import uuid
import base64
import models
from werkzeug.utils import secure_filename
from face_processing import extract_and_align_face, extract_embedding, identify_employee, draw_face_box, process_registration_video
import io
import json
from functools import wraps
from werkzeug.security import check_password_hash, generate_password_hash

# Tắt các warning không cần thiết
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['SECRET_KEY'] = 'your_secret_key_here'  # Thêm secret key vào config

# Đảm bảo thư mục uploads tồn tại
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Khởi tạo database
models.init_db()

# Khởi tạo các biến global
camera = None
camera_lock = threading.Lock()
camera_running = False
camera_initialized = False

# Khởi tạo MediaPipe Face Detection
mp_face_detection = mp.solutions.face_detection
mp_drawing = mp.solutions.drawing_utils
face_detection = mp_face_detection.FaceDetection(
    model_selection=0,  # Model 0 tối ưu cho khoảng cách gần (<2m)
    min_detection_confidence=0.5
)

# Biến theo dõi trạng thái
current_confidence = 0.0
face_detected = False
face_encoding = None
detected_employee = None
last_detection_time = 0
detection_status = "Chưa phát hiện"

# Credentials
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123" # Trong thực tế, nên lưu mã hash

# Biến global để theo dõi khởi tạo camera
_camera_init_thread = None
_camera_ready = False

def get_db_connection():
    """Tạo kết nối database"""
    return models.get_db_connection()

def wait_for_camera(timeout=5):
    """Đợi cho đến khi camera sẵn sàng với timeout"""
    global camera, camera_initialized
    
    start_time = time.time()
    while time.time() - start_time < timeout:
        if camera is not None and camera.isOpened():
            return True
        time.sleep(0.1)
    
    # Nếu camera chưa được khởi tạo, thử khởi tạo
    if camera is None or not camera.isOpened():
        return init_camera()
    
    return False

def init_camera():
    """Khởi tạo camera"""
    global camera, camera_initialized
    
    # Giải phóng camera cũ nếu có
    if camera is not None:
        camera.release()
    
    try:
        print("Đang khởi tạo camera...")
        # Liệt kê tất cả camera có sẵn
        available_cameras = []
        for i in range(3):  # Thử tối đa 3 camera
            cap = cv2.VideoCapture(i)
            if cap.isOpened():
                available_cameras.append(i)
                cap.release()
        
        print(f"Các camera có sẵn: {available_cameras}")
        
        # Thử kết nối từng camera
        for cam_id in available_cameras:
            print(f"Thử kết nối với camera {cam_id}...")
            camera = cv2.VideoCapture(cam_id)
            
            if camera.isOpened():
                # Đọc thử một frame để đảm bảo camera hoạt động tốt
                ret, frame = camera.read()
                if ret and frame is not None:
                    print(f"Đã kết nối thành công với camera {cam_id}")
                    camera_initialized = True
                    return True
                else:
                    print(f"Camera {cam_id} không đọc được frame")
                    camera.release()
        
        print("Không thể kết nối với bất kỳ camera nào!")
        return False
        
    except Exception as e:
        print(f"Lỗi khởi tạo camera: {str(e)}")
        if camera and camera.isOpened():
            camera.release()
        camera = None
        return False

def create_error_frame(message):
    """Tạo frame hiển thị lỗi"""
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(frame, message, (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    ret, buffer = cv2.imencode('.jpg', frame)
    return buffer.tobytes()

def process_frame(frame):
    """Xử lý frame từ camera"""
    global current_confidence, face_detected, detected_employee, face_encoding, last_detection_time, detection_status
    
    try:
        # Deep copy để tránh sửa đổi frame gốc
        processed_frame = frame.copy()
        
        # Phát hiện khuôn mặt với MediaPipe
        frame_rgb = cv2.cvtColor(processed_frame, cv2.COLOR_BGR2RGB)
        results = face_detection.process(frame_rgb)
        
        if results.detections:
            for detection in results.detections:
                # Lấy tọa độ khuôn mặt
                bbox = detection.location_data.relative_bounding_box
                h, w, _ = processed_frame.shape
                x = int(bbox.xmin * w)
                y = int(bbox.ymin * h)
                width = int(bbox.width * w)
                height = int(bbox.height * h)
                
                # Vẽ bounding box với độ dày 2
                cv2.rectangle(processed_frame, (x, y), (x + width, y + height), (0, 255, 0), 2)
                
                # Hiển thị text "Đang nhận diện..." phía trên bounding box
                label = "Đang nhận diện..."
                cv2.putText(processed_frame, label, (x, y - 10), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
        
        # Thêm dòng chữ "Camera đang hoạt động" góc trên bên trái
        cv2.putText(processed_frame, "Camera đang hoạt động", (10, 30), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        
        return processed_frame
        
    except Exception as e:
        print(f"Lỗi xử lý frame: {str(e)}")
        # Trả về frame gốc nếu có lỗi
        return frame

@app.route('/')
def index():
    """Trang chủ"""
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    """Video streaming route"""
    return Response(generate_frames(),
                   mimetype='multipart/x-mixed-replace; boundary=frame')

def generate_frames():
    """Generator để tạo frame liên tục cho video stream"""
    global camera, camera_running
    
    # Đợi camera khởi tạo xong với timeout 2 giây
    if not wait_for_camera(2):
        # Hiển thị frame thông báo "Đang kết nối camera..."
        error_frame = np.zeros((360, 480, 3), dtype=np.uint8)
        cv2.putText(error_frame, "Đang kết nối camera...", (50, 180), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        ret, buffer = cv2.imencode('.jpg', error_frame)
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
    
    # Khởi tạo camera nếu chưa sẵn sàng
    if not camera_initialized:
        # Hiển thị thông báo lỗi
        error_frame = np.zeros((360, 480, 3), dtype=np.uint8)
        cv2.putText(error_frame, "Không thể kết nối camera!", (50, 180), 
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            
        ret, buffer = cv2.imencode('.jpg', error_frame)
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        return
    
    camera_running = True
    
    try:
        while camera_running:
            # Đọc frame từ camera
            success, frame = camera.read()
            if not success:
                # Hiển thị thông báo lỗi và thử lại sau 0.1 giây
                print("Không thể đọc frame từ camera")
                time.sleep(0.1)
                continue
            
            # Xử lý frame với phát hiện khuôn mặt
            processed_frame = process_frame(frame)
            
            # Chuyển frame thành JPEG
            ret, buffer = cv2.imencode('.jpg', processed_frame)
            frame_bytes = buffer.tobytes()
            
            # Trả về frame
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            
            # Giảm tải CPU
            time.sleep(0.03)
            
    except Exception as e:
        print(f"Lỗi stream video: {str(e)}")
    finally:
        camera_running = False

@app.route('/status')
def status():
    """API endpoint để lấy trạng thái camera"""
    global camera, last_detection_time, face_detected, current_confidence, detected_employee, detection_status
    
    try:
        is_connected = camera is not None and camera.isOpened()
        
        if is_connected:
            # Kiểm tra xem khuôn mặt còn hiện diện không (timeout 3 giây)
            if face_detected and time.time() - last_detection_time > 3:
                face_detected = False
                current_confidence = 0.0
                detection_status = "Chưa phát hiện khuôn mặt"
        
        employee_data = None
        if detected_employee:
            employee_data = {
                'id': detected_employee['id'],
                'name': detected_employee['name'],
                'employee_code': detected_employee['employee_code'],
                'profile_image': detected_employee['profile_image']
            }
        
        return jsonify({
            'connected': is_connected,
            'face_detected': face_detected,
            'confidence': current_confidence,
            'detection_status': detection_status,
            'employee': employee_data
        })
    except Exception as e:
        return jsonify({'connected': False, 'error': str(e)})

@app.route('/start_camera', methods=['POST'])
def start_camera():
    """API endpoint để bắt đầu camera"""
    if init_camera():
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'error': 'Không thể kết nối camera'})

@app.route('/stop_camera', methods=['POST'])
def stop_camera():
    """API endpoint để dừng camera"""
    global camera, camera_running
    
    camera_running = False
    
    with camera_lock:
        if camera is not None:
            camera.release()
            camera = None

    return jsonify({'success': True})

@app.route('/tts')
def text_to_speech():
    """API endpoint để chuyển đổi văn bản thành giọng nói"""
    text = request.args.get('text', '')
    
    if not text:
        return Response("Không có văn bản được cung cấp", status=400)
    
    try:
        tts = gTTS(text=text, lang='vi')
        fp = BytesIO()
        tts.write_to_fp(fp)
        fp.seek(0)
        
        return send_file(fp, mimetype="audio/mp3")
    except Exception as e:
        print(f"Lỗi TTS: {str(e)}")
        return Response(f"Lỗi: {str(e)}", status=500)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        try:
            # Lấy dữ liệu từ form
            employee_code = request.form.get('employee_code')
            name = request.form.get('name')
            department_id = request.form.get('department')
            position = request.form.get('position')
            video_data = request.form.get('video_data')
            
            if not all([employee_code, name, video_data]):
                return jsonify({
                    'success': False,
                    'error': 'Vui lòng điền đầy đủ thông tin'
                })
            
            # Xử lý video và trích xuất khuôn mặt
            face_embeddings = process_registration_video(video_data)
            if not face_embeddings:
                return jsonify({
                    'success': False,
                    'error': 'Không thể trích xuất khuôn mặt từ video'
                })
            
            # Lưu vào database
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO employee (
                    company_id, employee_code, name, 
                    department_id, position, face_embeddings
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, (
                session.get('admin_company_id', 1),
                employee_code, name, department_id,
                position, face_embeddings
            ))
            
            conn.commit()
            conn.close()
            
            return jsonify({'success': True})
            
        except Exception as e:
            print(f"Registration error: {str(e)}")
            return jsonify({'success': False, 'error': str(e)})
            
    # GET request
    departments = []
    try:
        conn = get_db_connection()
        departments = conn.execute("""
            SELECT * FROM department 
            WHERE company_id = ?
        """, (session.get('admin_company_id', 1),)).fetchall()
    except Exception as e:
        print(f"Error loading departments: {str(e)}")
    finally:
        if 'conn' in locals():
            conn.close()
            
    return render_template('register.html', departments=departments)

@app.route('/active-employees')
def get_active_employees():
    """API endpoint để lấy danh sách nhân viên đang làm việc"""
    try:
        active_employees = models.get_active_employees()
        return jsonify(active_employees)
    except Exception as e:
        print(f"Lỗi khi lấy danh sách nhân viên: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/employee-history/<int:employee_id>')
def employee_history(employee_id):
    """API endpoint để lấy lịch sử chấm công của nhân viên"""
    try:
        # Kiểm tra nhân viên
        employee = models.get_employee_by_id(employee_id)
        if not employee:
            return jsonify({'error': 'Employee not found'}), 404
        
        # Lấy lịch sử check logs
        check_logs = models.get_employee_check_logs(employee_id)
        
        return jsonify({
            'employee': {
                'id': employee['id'],
                'name': employee['name'],
                'employee_code': employee['employee_code']
            },
            'history': check_logs
        })
    except Exception as e:
        print(f"Lỗi khi lấy lịch sử nhân viên: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/register-form')
def register_form():
    """Trang đăng ký nhân viên mới"""
    return render_template('register.html')

@app.route('/capture_frame', methods=['GET'])
def capture_frame():
    """API endpoint để chụp ảnh từ camera"""
    global camera, camera_lock
    
    if not camera:
        return jsonify({'success': False, 'error': 'Camera not available'})
    
    try:
        with camera_lock:
            ret, frame = camera.read()
            if not ret:
                return jsonify({'success': False, 'error': 'Failed to capture frame'})
                
            # Chuyển frame thành base64
            ret, buffer = cv2.imencode('.jpg', frame)
            if not ret:
                return jsonify({'success': False, 'error': 'Failed to encode frame'})
                
            image_data = base64.b64encode(buffer).decode('utf-8')
            return jsonify({'success': True, 'image': image_data})
    except Exception as e:
        print(f"Lỗi khi chụp ảnh: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/submit-complaint', methods=['POST'])
def submit_complaint():
    """API endpoint để gửi đơn khiếu nại"""
    try:
        # Lấy dữ liệu từ form
        employee_code = request.form.get('employeeCode')
        reason = request.form.get('reason')
        details = request.form.get('details')
        requested_time_str = request.form.get('requestedTime')
        image_data = request.form.get('image')
        
        # Kiểm tra dữ liệu
        if not employee_code or not reason:
            return jsonify({'success': False, 'error': 'Missing required fields'})
            
        # Tìm nhân viên theo mã
        employee = models.get_employee_by_code(employee_code)
        if not employee:
            return jsonify({'success': False, 'error': 'Employee not found'})
            
        # Xử lý ảnh nếu có
        photo_path = None
        if image_data:
            # Lưu ảnh từ base64
            filename = f"complaint_{employee['employee_code']}_{int(time.time())}.jpg"
            photo_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            
            # Decode và lưu ảnh
            try:
                image_data = base64.b64decode(image_data)
                with open(photo_path, 'wb') as f:
                    f.write(image_data)
                photo_path = f"uploads/{filename}"
            except:
                photo_path = None
        
        # Xử lý thời gian yêu cầu nếu có
        requested_time = None
        if requested_time_str:
            try:
                requested_time = datetime.fromisoformat(requested_time_str)
            except:
                pass
        
        # Tạo bản ghi khiếu nại mới
        complaint_data = {
            'employee_id': employee['id'],
            'photo': photo_path,
            'reason': reason,
            'details': details,
            'requested_time': requested_time.isoformat() if requested_time else None
        }
        
        complaint_id = models.add_complaint(complaint_data)
        
        return jsonify({
            'success': True,
            'message': 'Đơn khiếu nại đã được gửi thành công',
            'complaint_id': complaint_id
        })
    except Exception as e:
        print(f"Lỗi khi gửi đơn khiếu nại: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/admin')
def admin_panel():
    """Trang quản trị"""
    if not session.get('admin_logged_in') and not session.get('admin_company_id'):
        return redirect(url_for('admin_login'))
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/attendance')
def admin_attendance():
    """Trang quản lý lịch sử chấm công"""
    if not session.get('admin_logged_in'):
        return redirect(url_for('admin_login'))
    return render_template('admin/attendance.html')

@app.route('/admin/employees_page')
def admin_employees_page():
    """Trang quản lý nhân viên"""
    return render_template('admin_employees.html')

@app.route('/admin/employees')
def admin_employees():
    """Trang quản lý nhân viên"""
    if not session.get('admin_logged_in'):
        return redirect(url_for('admin_login'))
        
    try:
        conn = get_db_connection()
        employees = conn.execute("""
            SELECT e.*, d.name as department_name 
            FROM employee e
            LEFT JOIN department d ON e.department_id = d.id
            WHERE e.company_id = ?
            ORDER BY e.created_at DESC
        """, (session['admin_company_id'],)).fetchall()
        
        # Convert string dates to datetime objects
        for employee in employees:
            if employee['created_at']:
                employee['created_at'] = datetime.fromisoformat(employee['created_at'])
                
        return render_template('admin/employees.html', employees=employees)
        
    except Exception as e:
        print(f"Employees error: {str(e)}")
        flash('Không thể tải danh sách nhân viên', 'error')
        return redirect(url_for('admin_dashboard'))



@app.route('/admin/login', methods=['POST'])
def admin_login():
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        
        print(f"Login attempt - Username: {username}")
        
        # Kiểm tra tài khoản admin mặc định
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            conn = get_db_connection()
            company = conn.execute("""
                SELECT id, name, settings_json 
                FROM company 
                WHERE code = ?
            """, ('DEFAULT',)).fetchone()
            
            if company:
                session['admin_logged_in'] = True
                session['admin_company_id'] = company['id']
                session['company_code'] = 'DEFAULT'
                session['company_name'] = company['name']
                
                if company['settings_json']:
                    settings = json.loads(company['settings_json'])
                    session['company_settings'] = settings
                    
                return jsonify({'success': True})
                
        return jsonify({
            'success': False, 
            'error': 'Tên đăng nhập hoặc mật khẩu không đúng'
        })
            
    except Exception as e:
        print(f"Login error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/v1/admin/dashboard-stats')
def get_dashboard_stats():
    """API endpoint để lấy thống kê cho dashboard"""
    if not session.get('admin_logged_in'):
        return jsonify({'error': 'Unauthorized'}), 401
        
    try:
        conn = get_db_connection()
        
        # Kiểm tra cấu trúc bảng
        has_company_id = False
        table_info = conn.execute("PRAGMA table_info(employee)").fetchall()
        for column in table_info:
            if column[1] == 'company_id':
                has_company_id = True
                break
        
        # Truy vấn dựa trên cấu trúc bảng thực tế
        if has_company_id:
            # Nếu có company_id
            stats = conn.execute("""
                SELECT 
                    COUNT(*) as total_employees,
                    COUNT(CASE WHEN a.status = 'on_time' AND DATE(a.check_in_time) = DATE('now') THEN 1 END) as on_time_today,
                    COUNT(CASE WHEN a.status = 'late' AND DATE(a.check_in_time) = DATE('now') THEN 1 END) as late_today,
                    COUNT(DISTINCT e.id) - COUNT(DISTINCT CASE WHEN DATE(a.check_in_time) = DATE('now') THEN e.id END) as absent_today
                FROM employee e
                LEFT JOIN attendance a ON e.id = a.employee_id
                WHERE e.company_id = ?
            """, (session.get('admin_company_id', 1),)).fetchone()
        else:
            # Nếu không có company_id
            stats = conn.execute("""
                SELECT 
                    COUNT(*) as total_employees,
                    COUNT(CASE WHEN a.status = 'on_time' AND DATE(a.check_in_time) = DATE('now') THEN 1 END) as on_time_today,
                    COUNT(CASE WHEN a.status = 'late' AND DATE(a.check_in_time) = DATE('now') THEN 1 END) as late_today,
                    COUNT(DISTINCT e.id) - COUNT(DISTINCT CASE WHEN DATE(a.check_in_time) = DATE('now') THEN e.id END) as absent_today
                FROM employee e
                LEFT JOIN attendance a ON e.id = a.employee_id
            """).fetchone()
        
        return jsonify({
            'stats': dict(stats),
            'weekly_stats': [] # Thêm dữ liệu weekly nếu cần
        })
        
    except Exception as e:
        print(f"Dashboard stats error: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.context_processor
def utility_processor():
    """Add utility functions/variables to template context"""
    return {
        'now': datetime.now()
    }

@app.route('/admin/dashboard')
def admin_dashboard():
    """Trang dashboard"""
    if not session.get('admin_logged_in'):
        return redirect(url_for('admin_login'))
        
    try:
        conn = get_db_connection()
        
        # Lấy thống kê chấm công hôm nay
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow = today + timedelta(days=1)
        
        stats = {
            'total_employees': conn.execute(
                'SELECT COUNT(*) as count FROM employee WHERE company_id = ?',
                (session['admin_company_id'],)
            ).fetchone()['count'],
            
            'present_today': conn.execute("""
                SELECT COUNT(DISTINCT employee_id) as count 
                FROM attendance 
                WHERE company_id = ? AND check_in_time BETWEEN ? AND ?
                AND status = 'on_time'
            """, (session['admin_company_id'], today.isoformat(), tomorrow.isoformat())
            ).fetchone()['count'],
            
            'late_today': conn.execute("""
                SELECT COUNT(DISTINCT employee_id) as count 
                FROM attendance 
                WHERE company_id = ? AND check_in_time BETWEEN ? AND ?
                AND status = 'late'
            """, (session['admin_company_id'], today.isoformat(), tomorrow.isoformat())
            ).fetchone()['count']
        }
        
        # Lấy 5 lần chấm công gần nhất
        recent_attendance = conn.execute("""
            SELECT 
                a.check_in_time,
                a.status,
                e.name as employee_name,
                e.employee_code,
                d.name as department_name
            FROM attendance a
            JOIN employee e ON a.employee_id = e.id
            LEFT JOIN department d ON e.department_id = d.id
            WHERE a.company_id = ?
            ORDER BY a.check_in_time DESC
            LIMIT 5
        """, (session['admin_company_id'],)).fetchall()
        
        return render_template('admin/dashboard.html',
                            stats=stats,
                            recent_attendance=recent_attendance)
                            
    except Exception as e:
        print(f"Dashboard error: {str(e)}")
        flash('Không thể tải dữ liệu dashboard', 'error')
        return render_template('admin/dashboard.html')

@app.route('/admin/complaint/<int:complaint_id>')
def get_complaint_detail(complaint_id):
    """API endpoint để lấy chi tiết đơn khiếu nại"""
    try:
        complaint = models.get_complaint_by_id(complaint_id)
        if not complaint:
            return jsonify({'error': 'Không tìm thấy đơn khiếu nại'}), 404
            
        return jsonify(complaint)
    except Exception as e:
        print(f"Lỗi khi lấy chi tiết đơn khiếu nại: {str(e)}")
        return jsonify({'error': str(e)}), 500

def api_key_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        api_key = request.headers.get('X-API-Key')
        if not api_key:
            return jsonify({'error': 'API key is missing'}), 401
            
        # Kiểm tra API key trong database
        conn = get_db_connection()
        company = conn.execute('SELECT * FROM companies WHERE api_key = ?', (api_key,)).fetchone()
        conn.close()
        
        if not company:
            return jsonify({'error': 'Invalid API key'}), 401
            
        # Thêm company_id vào request để các hàm khác có thể sử dụng
        request.company_id = company['id']
        return f(*args, **kwargs)
        
    return decorated_function

@api_key_required
def checkin(company_id):
    """API endpoint để chấm công"""
    try:
        # Lấy dữ liệu từ request
        data = request.get_json()
        employee_id = data.get('employee_id')
        photo_path = data.get('photo_path')
        confidence_score = data.get('confidence_score', 0.0)
        device_info = data.get('device_info')
        location = data.get('location')
        
        # Xử lý chấm công
        result = process_attendance(
            company_id=company_id,
            employee_id=employee_id,
            photo_path=photo_path,
            confidence_score=confidence_score,
            device_info=device_info,
            location=location
        )
        
        return jsonify(result)
        
    except Exception as e:
        print(f"Lỗi API chấm công: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

def process_attendance(company_id, employee_id, photo_path, confidence_score, device_info=None, location=None):
    """Xử lý thông tin chấm công"""
    try:
        # Kiểm tra thông tin đầu vào
        if not all([company_id, employee_id, photo_path]):
            return {"success": False, "error": "Thiếu thông tin bắt buộc"}
            
        # Lấy kết nối database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Lấy thông tin nhân viên
        cursor.execute("""
            SELECT name, employee_code FROM employee 
            WHERE id = ? AND company_id = ?
        """, (employee_id, company_id))
        employee = cursor.fetchone()
        
        if not employee:
            return {"success": False, "error": "Không tìm thấy nhân viên"}
            
        # Ghi nhận chấm công
        now = datetime.now()
        cursor.execute("""
            INSERT INTO attendance (
                company_id, employee_id, check_in_time, 
                photo_path, confidence_score, device_info, location
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            company_id, employee_id, now.isoformat(),
            photo_path, confidence_score,
            json.dumps(device_info) if device_info else None,
            json.dumps(location) if location else None
        ))
        
        attendance_id = cursor.lastrowid
        conn.commit()
        
        return {
            "success": True,
            "attendance_id": attendance_id,
            "employee": {
                "name": employee['name'],
                "employee_code": employee['employee_code']
            },
            "check_in_time": now.isoformat()
        }
        
    except Exception as e:
        print(f"Lỗi xử lý chấm công: {str(e)}")
        return {"success": False, "error": str(e)}
    finally:
        if 'conn' in locals():
            conn.close()

@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_logged_in', None)
    session.pop('admin_company_id', None)
    session.pop('company_code', None)
    return redirect(url_for('index'))

@app.route('/process_frame', methods=['POST'])
def process_frame():
    """API endpoint để xử lý frame với MTCNN"""
    try:
        data = request.get_json()
        frame_data = data['frame'].split(',')[1]  # Remove data:image/jpeg;base64,
        frame_bytes = base64.b64decode(frame_data)
        
        # Chuyển frame thành numpy array
        nparr = np.frombuffer(frame_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Phát hiện và cắt khuôn mặt với MTCNN
        face = extract_and_align_face(frame)
        if face is None:
            return jsonify({'success': False, 'error': 'Không phát hiện được khuôn mặt'})
            
        # Chuyển ảnh khuôn mặt thành base64
        _, buffer = cv2.imencode('.jpg', face)
        face_b64 = base64.b64encode(buffer).decode('utf-8')
        
        return jsonify({
            'success': True,
            'face_image': f'data:image/jpeg;base64,{face_b64}'
        })
        
    except Exception as e:
        print(f"Error processing frame: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/retrain_model', methods=['POST'])
def retrain_model():
    """API endpoint để huấn luyện lại mô hình"""
    try:
        # Lấy tất cả embedding từ database
        conn = get_db_connection()
        embeddings = conn.execute('SELECT * FROM embedding').fetchall()
        
        if not embeddings:
            return jsonify({'success': False, 'error': 'Không có dữ liệu embedding'})
            
        # Chuẩn bị dữ liệu huấn luyện
        X = np.array([np.frombuffer(e['vector'], dtype=np.float32) for e in embeddings])
        y = np.array([e['employee_id'] for e in embeddings])
        
        # Huấn luyện lại mô hình
        model = train_classifier(X, y)
        
        # Lưu mô hình
        save_model(model)
        
        return jsonify({'success': True})
        
    except Exception as e:
        print(f"Error retraining model: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/admin/settings')
def admin_settings():
    """Trang cài đặt hệ thống"""
    if not session.get('admin_logged_in'):
        return redirect(url_for('admin_login'))
        
    try:
        conn = get_db_connection()
        settings = conn.execute("""
            SELECT settings_json 
            FROM company 
            WHERE id = ?
        """, (session['admin_company_id'],)).fetchone()
        
        if settings and settings['settings_json']:
            settings = json.loads(settings['settings_json'])
        else:
            settings = {
                'work_start_time': '08:00',
                'work_end_time': '17:30',
                'late_threshold': 15
            }
            
        return render_template('admin/settings.html', settings=settings)
        
    except Exception as e:
        print(f"Settings error: {str(e)}")
        flash('Không thể tải cài đặt', 'error')
        return redirect(url_for('admin_dashboard'))

@app.route('/static/img/admin-avatar.png')
def default_avatar():
    return send_file('static/img/defaults/admin-avatar.png')

@app.route('/static/img/company-logo.png') 
def default_logo():
    return send_file('static/img/defaults/company-logo.png')

@app.route('/static/img/default-avatar.png')
def default_avatar_img():
    """Trả về ảnh avatar mặc định"""
    try:
        # Tạo thư mục nếu chưa tồn tại
        os.makedirs('static/img/defaults', exist_ok=True)
        
        # Kiểm tra xem file có tồn tại ở vị trí mới không
        if os.path.exists('static/img/defaults/default-avatar.png'):
            return send_file('static/img/defaults/default-avatar.png')
        
        # Nếu không, kiểm tra ở vị trí cũ
        if os.path.exists('static/img/default-avatar.png'):
            return send_file('static/img/default-avatar.png')
            
        # Nếu không tìm thấy, tạo ảnh mặc định
        img = np.ones((200, 200, 3), dtype=np.uint8) * 240  # Tạo ảnh xám
        cv2.circle(img, (100, 100), 80, (200, 200, 200), -1)  # Vẽ hình tròn
        cv2.circle(img, (100, 80), 30, (240, 240, 240), -1)  # Vẽ đầu
        cv2.ellipse(img, (100, 130), (50, 30), 0, 0, 180, (240, 240, 240), -1)  # Vẽ thân
        
        # Lưu ảnh vào buffer
        _, buffer = cv2.imencode('.png', img)
        return Response(buffer.tobytes(), mimetype='image/png')
    except Exception as e:
        print(f"Lỗi khi tạo avatar mặc định: {str(e)}")
        # Trả về 1x1 pixel transparent
        return Response(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x00\x00\x02\x00\x01\x9a\x00\xe3G\x00\x00\x00\x00IEND\xaeB`\x82', mimetype='image/png')

@app.route('/api/v1/admin/report-data', methods=['POST'])
def get_report_data():
    return jsonify({'error': 'API không còn được hỗ trợ'}), 404

def get_employee_by_id(employee_id):
    """Lấy thông tin nhân viên theo ID"""
    conn = get_db_connection()
    row = conn.execute('SELECT * FROM employee WHERE id = ?', (employee_id,)).fetchone()
    conn.close()
    
    # Chuyển Row object thành dict
    if row:
        return dict(row)
    return None

@app.route('/api/employee-info')
def get_employee_info_api():
    """API endpoint để lấy thông tin nhân viên theo mã"""
    employee_code = request.args.get('code')
    if not employee_code:
        return jsonify({'success': False, 'error': 'Thiếu mã nhân viên'})
    
    try:
        conn = get_db_connection()
        employee = conn.execute(
            'SELECT * FROM employee WHERE employee_code = ?', 
            (employee_code,)
        ).fetchone()
        conn.close()
        
        if employee:
            return jsonify({
                'success': True,
                'employee': dict(employee)
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Không tìm thấy nhân viên'
            })
    except Exception as e:
        print(f"Error getting employee info: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/capture-raw-frame', methods=['GET'])
def capture_raw_frame():
    """API để chụp ảnh nguyên bản từ camera"""
    try:
        if not wait_for_camera():
            return jsonify({
                'success': False,
                'error': 'Không thể kết nối camera'
            })
        
        # Chụp frame hiện tại
        ret, frame = camera.read()
        if not ret:
            return jsonify({
                'success': False,
                'error': 'Không thể đọc từ camera'
            })
        
        # Chuyển thành base64
        _, buffer = cv2.imencode('.jpg', frame)
        frame_b64 = base64.b64encode(buffer).decode('utf-8')
        
        return jsonify({
            'success': True,
            'image': f'data:image/jpeg;base64,{frame_b64}'
        })
    except Exception as e:
        print(f"Error capturing raw frame: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/admin/complaints')
def admin_complaints():
    """Trang quản lý khiếu nại"""
    if not session.get('admin_logged_in'):
        return redirect(url_for('admin_login'))
        
    try:
        conn = get_db_connection()
        complaints = conn.execute('''
            SELECT c.*, e.name as employee_name, e.employee_code
            FROM complaints c
            JOIN employee e ON c.employee_id = e.id
            WHERE c.company_id = ?
            ORDER BY c.created_at DESC
        ''', (session['admin_company_id'],)).fetchall()
        
        return render_template('admin/complaints.html', complaints=[dict(c) for c in complaints])
        
    except Exception as e:
        print(f"Complaints error: {str(e)}")
        flash('Không thể tải danh sách khiếu nại', 'error')
        return redirect(url_for('admin_dashboard'))

@app.route('/admin/complaints/approve/<int:complaint_id>', methods=['POST'])
def approve_complaint(complaint_id):
    """Duyệt đơn khiếu nại"""
    if not session.get('admin_logged_in'):
        return jsonify({'success': False, 'error': 'Unauthorized'})
        
    try:
        data = request.get_json() or {}
        
        conn = get_db_connection()
        
        # Lấy thông tin khiếu nại và chuyển thành dict
        complaint_row = conn.execute(
            'SELECT * FROM complaints WHERE id = ?', (complaint_id,)
        ).fetchone()
        
        if not complaint_row:
            return jsonify({'success': False, 'error': 'Không tìm thấy khiếu nại'})
            
        # Chuyển Row thành dict
        complaint = dict_from_row(complaint_row)
        
        # Kiểm tra đã có bản ghi chấm công hôm nay chưa
        today = datetime.now().strftime('%Y-%m-%d')
        attendance = conn.execute('''
            SELECT * FROM attendance 
            WHERE employee_id = ? AND DATE(check_in_time) = ?
        ''', (complaint['employee_id'], today)).fetchone()
        
        # Cách này an toàn hơn
        complaint_time = datetime.fromisoformat(complaint['complaint_time'].replace('Z', '+00:00') if complaint['complaint_time'].endswith('Z') else complaint['complaint_time'])
        
        # Nếu chưa có bản ghi => tạo mới (check in)
        if not attendance:
            conn.execute('''
                INSERT INTO attendance (
                    employee_id, company_id, check_in_time, status
                ) VALUES (?, ?, ?, ?)
            ''', (
                complaint['employee_id'],
                complaint['company_id'],
                complaint_time,
                'manual'
            ))
        else:
            # Nếu đã có bản ghi => cập nhật (check out)
            conn.execute('''
                UPDATE attendance
                SET check_out_time = ?
                WHERE id = ?
            ''', (complaint_time, attendance['id']))
        
        # Cập nhật trạng thái khiếu nại
        conn.execute('''
            UPDATE complaints
            SET status = ?, admin_note = ?
            WHERE id = ?
        ''', ('approved', data.get('note', ''), complaint_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        print(f"Approve complaint error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/admin/complaints/reject/<int:complaint_id>', methods=['POST'])
def reject_complaint(complaint_id):
    """Từ chối đơn khiếu nại"""
    if not session.get('admin_logged_in'):
        return jsonify({'success': False, 'error': 'Unauthorized'})
        
    try:
        data = request.get_json()
        reason = data.get('reason')
        
        if not reason:
            return jsonify({'success': False, 'error': 'Vui lòng cung cấp lý do từ chối'})
            
        conn = get_db_connection()
        conn.execute('''
            UPDATE complaints
            SET status = ?, admin_note = ?
            WHERE id = ?
        ''', ('rejected', reason, complaint_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        print(f"Reject complaint error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/complaint/<int:complaint_id>')
def get_complaint_api(complaint_id):
    """API endpoint để lấy thông tin chi tiết khiếu nại"""
    if not session.get('admin_logged_in'):
        return jsonify({'success': False, 'error': 'Unauthorized'})
        
    try:
        conn = get_db_connection()
        complaint = conn.execute('''
            SELECT c.*, e.name as employee_name, e.employee_code
            FROM complaints c
            JOIN employee e ON c.employee_id = e.id
            WHERE c.id = ?
        ''', (complaint_id,)).fetchone()
        
        if not complaint:
            return jsonify({'success': False, 'error': 'Không tìm thấy khiếu nại'})
            
        return jsonify({
            'success': True,
            'complaint': dict(complaint)
        })
        
    except Exception as e:
        print(f"Get complaint error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/capture-complaint-image')
def capture_complaint_image():
    """API để chụp ảnh khiếu nại từ server"""
    try:
        # Kiểm tra camera
        if not init_camera():
            return jsonify({
                'success': False,
                'error': 'Không thể kết nối camera'
            })
        
        # Chụp frame hiện tại
        ret, frame = camera.read()
        if not ret or frame is None:
            return jsonify({
                'success': False,
                'error': 'Không thể đọc từ camera'
            })
        
        # Chuyển thành base64
        _, buffer = cv2.imencode('.jpg', frame)
        frame_b64 = base64.b64encode(buffer).decode('utf-8')
        
        return jsonify({
            'success': True,
            'image': f'data:image/jpeg;base64,{frame_b64}'
        })
    except Exception as e:
        print(f"Error capturing complaint image: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

# Thêm hàm này để chuyển sqlite3.Row thành dict
def dict_from_row(row):
    """Chuyển đổi sqlite3.Row thành dict"""
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}

@app.route('/today-attendance')
def today_attendance():
    """API endpoint lấy danh sách chấm công hôm nay"""
    try:
        conn = get_db_connection()
        
        # Lấy ngày hiện tại
        today = datetime.now().strftime('%Y-%m-%d')
        
        # Truy vấn danh sách chấm công
        attendance_list = conn.execute('''
            SELECT a.*, e.name, e.employee_code
            FROM attendance a
            JOIN employee e ON a.employee_id = e.id
            WHERE DATE(a.check_in_time) = ?
            ORDER BY a.check_in_time DESC
        ''', (today,)).fetchall()
        
        # Chuyển về dạng dict
        result = []
        for item in attendance_list:
            attendance_dict = dict_from_row(item)
            # Format lại thời gian cho dễ đọc
            if attendance_dict.get('check_in_time'):
                check_in = datetime.fromisoformat(attendance_dict['check_in_time'].replace('Z', '+00:00'))
                attendance_dict['check_in_time_formatted'] = check_in.strftime('%H:%M:%S')
            
            if attendance_dict.get('check_out_time'):
                check_out = datetime.fromisoformat(attendance_dict['check_out_time'].replace('Z', '+00:00'))
                attendance_dict['check_out_time_formatted'] = check_out.strftime('%H:%M:%S')
            
            result.append(attendance_dict)
        
        conn.close()
        return jsonify({'success': True, 'data': result})
        
    except Exception as e:
        print(f"Error getting today attendance: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

if __name__ == '__main__':
    # Khởi tạo camera trong thread riêng
    threading.Thread(target=init_camera, daemon=True).start()
    app.run(debug=True, threaded=True)
