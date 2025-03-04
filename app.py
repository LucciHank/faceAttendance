from flask import Flask, Response, render_template, jsonify, request, url_for, send_file, redirect, session
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
import models  # Import models mới
from werkzeug.utils import secure_filename
import hashlib

# Tắt các warning không cần thiết
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'static/uploads'

# Đảm bảo thư mục uploads tồn tại
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Khởi tạo database
models.init_db()

# Khởi tạo các biến global
camera = None
camera_lock = threading.Lock()
camera_running = False

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

# Thêm secret key cho Flask session
app.secret_key = "your_secret_key_here"

# Credentials
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123" # Trong thực tế, nên lưu mã hash

def init_camera():
    """Khởi tạo và kiểm tra camera"""
    global camera
    try:
        if camera is None:
            print("Đang kết nối camera...")
            camera = cv2.VideoCapture(0, cv2.CAP_DSHOW)
            camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            
            if not camera.isOpened():
                print("Không thể kết nối camera!")
                return False
                
            ret, frame = camera.read()
            if not ret:
                print("Không thể đọc frame từ camera!")
                camera.release()
                camera = None
                return False
                
            return True
        return True
    except Exception as e:
        print(f"Lỗi khi khởi tạo camera: {str(e)}")
        if camera is not None:
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
    """Xử lý frame với MediaPipe Face Detection"""
    global current_confidence, face_detected, detected_employee, last_detection_time, detection_status
    
    # Đảm bảo frame đúng định dạng
    if frame is None or not isinstance(frame, np.ndarray):
        error_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(error_frame, "Lỗi camera", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        return error_frame
        
    try:
        # Chuyển frame sang RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Phát hiện khuôn mặt bằng MediaPipe
        results = face_detection.process(rgb_frame)
        
        if results.detections:
            face_detected = True
            detection = results.detections[0]  # Lấy khuôn mặt đầu tiên
            current_confidence = detection.score[0]
            last_detection_time = time.time()
            
            # Vẽ khuôn mặt
            bbox = detection.location_data.relative_bounding_box
            h, w, _ = frame.shape
            x = int(bbox.xmin * w)
            y = int(bbox.ymin * h)
            width = int(bbox.width * w)
            height = int(bbox.height * h)
            
            # Vẽ bounding box
            cv2.rectangle(frame, (x, y), (x + width, y + height), (0, 255, 0), 2)
            
            return frame
        else:
            face_detected = False
            current_confidence = 0.0
            detection_status = "Chưa phát hiện khuôn mặt"
            return frame
                
    except Exception as e:
        print(f"Lỗi khi xử lý frame: {str(e)}")
        # Trả về frame gốc nếu có lỗi xử lý
        return frame

@app.route('/')
def index():
    """Trang chủ"""
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    """Stream video từ camera với face detection"""
    def generate_frames():
        global camera_running
        camera_running = True
        
        if not init_camera():
            # Trả về một loạt frames báo lỗi
            error_frame = create_error_frame("Không thể kết nối camera")
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + error_frame + b'\r\n')
            return
        
        while camera_running:
            try:
                # Đọc frame từ camera
                with camera_lock:
                    if camera is None or not camera.isOpened():
                        break
                    ret, frame = camera.read()
                
                if not ret or frame is None:
                    print("Lỗi khi đọc frame từ camera")
                    # Tạo frame lỗi
                    error_frame = create_error_frame("Lỗi đọc dữ liệu từ camera")
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + error_frame + b'\r\n')
                    time.sleep(0.5)
                    continue
                
                # Xử lý frame để phát hiện khuôn mặt
                processed_frame = process_frame(frame)
                
                # Tạo stream video
                try:
                    ret, buffer = cv2.imencode('.jpg', processed_frame)
                    if not ret:
                        continue
                    
                    frame_bytes = buffer.tobytes()
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                except Exception as e:
                    print(f"Lỗi khi tạo frame: {str(e)}")
                    continue
                
                time.sleep(0.01)  # 60 FPS
            except Exception as e:
                print(f"Lỗi trong generate_frames: {str(e)}")
                error_frame = create_error_frame(f"Lỗi: {str(e)}")
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + error_frame + b'\r\n')
                time.sleep(1)
    
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

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

@app.route('/register', methods=['POST'])
def register():
    """API endpoint để đăng ký nhân viên mới"""
    try:
        employee_code = request.form.get('employee_code')
        name = request.form.get('name')
        position = request.form.get('position', '')  # Thêm trường vị trí

        # Kiểm tra tính hợp lệ của dữ liệu
        if not employee_code or not name:
            return jsonify({'success': False, 'error': 'Vui lòng nhập đầy đủ thông tin'}), 400
        
        # Upload ảnh
        profile_image = None
        if 'profile_image' in request.files:
            file = request.files['profile_image']
            if file and file.filename:
                filename = secure_filename(f"{uuid.uuid4()}_{file.filename}")
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file.save(filepath)
                profile_image = os.path.join('uploads', filename)
        
        # Thêm nhân viên mới
        employee_id = models.add_employee({
            'employee_code': employee_code,
            'name': name,
            'position': position,
            'profile_image': profile_image
        })
        
        return jsonify({
            'success': True, 
            'message': f'Đã đăng ký nhân viên {name} thành công',
            'employee_id': employee_id
        })
    except Exception as e:
        print(f"Lỗi khi đăng ký nhân viên: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

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
    if not session.get('admin_logged_in'):
        return redirect('/')
    return render_template('admin.html')

@app.route('/admin/attendance')
def admin_attendance():
    """Trang quản lý lịch sử chấm công"""
    return render_template('admin_attendance.html')

@app.route('/admin/employees')
def admin_employees():
    """Trang quản lý nhân viên"""
    return render_template('admin_employees.html')

@app.route('/admin/employees-list')
def get_employees_list():
    """API endpoint lấy danh sách tất cả nhân viên"""
    try:
        employees = models.get_all_employees()
        return jsonify(employees)
    except Exception as e:
        print(f"Lỗi khi lấy danh sách nhân viên: {str(e)}")
        return jsonify({'error': str(e)}), 500

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

@app.route('/check', methods=['POST'])
def check():
    """API endpoint cho chấm công (check in/out)"""
    try:
        data = request.get_json()
        employee_id = data.get('employee_id')
        check_time_str = data.get('check_time')
        
        if not employee_id:
            return jsonify({'success': False, 'error': 'Không tìm thấy thông tin nhân viên'})
            
        # Chuyển đổi string thành datetime
        check_time = datetime.fromisoformat(check_time_str.replace('Z', '+00:00'))
        
        # Tìm nhân viên
        employee = models.get_employee_by_id(employee_id)
        if not employee:
            return jsonify({'success': False, 'error': 'Không tìm thấy nhân viên'})
        
        # Chụp ảnh hiện tại
        photo_path = None
        with camera_lock:
            ret, frame = camera.read()
            if ret:
                filename = f"check_{employee['employee_code']}_{int(time.time())}.jpg"
                save_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                cv2.imwrite(save_path, frame)
                photo_path = f"uploads/{filename}"
        
        # Thêm hoặc cập nhật bản ghi chấm công
        result = models.add_or_update_attendance(employee_id, check_time.isoformat(), photo_path)
        
        return jsonify({
            'success': True,
            'message': result['message'],
            'employee': {
                'id': employee['id'],
                'name': employee['name'],
                'employee_code': employee['employee_code']
            },
            'check_time': check_time.strftime('%Y-%m-%d %H:%M:%S')
        })
    except Exception as e:
        print(f"Lỗi khi chấm công: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/admin-login', methods=['POST'])
def admin_login():
    """Xử lý đăng nhập admin"""
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        session['admin_logged_in'] = True
        return jsonify({'success': True, 'redirect': '/admin'})
    else:
        return jsonify({'success': False, 'message': 'Tên đăng nhập hoặc mật khẩu không chính xác'}), 401

@app.route('/admin/stats')
def get_admin_stats():
    """API endpoint lấy số liệu thống kê cho dashboard"""
    try:
        # Số nhân viên đang làm việc
        conn = models.get_db_connection()
        active_employees = conn.execute('''
            SELECT COUNT(*) as count FROM attendance 
            WHERE date(check_in_time) = date('now') AND check_out_time IS NULL
        ''').fetchone()['count']
        
        # Tổng số nhân viên
        total_employees = conn.execute('SELECT COUNT(*) as count FROM employee').fetchone()['count']
        
        # Số lượt check-in hôm nay
        today_checkins = conn.execute('''
            SELECT COUNT(*) as count FROM attendance 
            WHERE date(check_in_time) = date('now')
        ''').fetchone()['count']
        
        # Số đơn khiếu nại đang chờ xử lý
        pending_complaints = conn.execute('''
            SELECT COUNT(*) as count FROM complaint 
            WHERE status = 'pending'
        ''').fetchone()['count']
        
        conn.close()
        
        return jsonify({
            'active_employees': active_employees,
            'total_employees': total_employees,
            'today_checkins': today_checkins,
            'pending_complaints': pending_complaints
        })
    except Exception as e:
        print(f"Lỗi khi lấy số liệu thống kê: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/admin/complaints')
def get_complaints():
    """API endpoint lấy danh sách tất cả các đơn khiếu nại"""
    try:
        complaints = models.get_all_complaints()
        return jsonify(complaints)
    except Exception as e:
        print(f"Lỗi khi lấy danh sách khiếu nại: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/admin/process-complaint', methods=['POST'])
def process_complaint():
    """API endpoint xử lý đơn khiếu nại"""
    try:
        data = request.get_json()
        complaint_id = data.get('complaint_id')
        status = data.get('status')  # approved hoặc rejected
        admin_note = data.get('admin_note')
        
        if not complaint_id or not status:
            return jsonify({'success': False, 'error': 'Thiếu thông tin cần thiết'})
        
        # Sử dụng admin có ID 1 (sau này sẽ dùng admin đăng nhập)
        admin_id = 1
        
        # Cập nhật trạng thái đơn
        models.process_complaint(complaint_id, status, admin_id, admin_note)
        
        # Nếu duyệt đơn và có thời gian yêu cầu, cập nhật lại thời gian chấm công
        if status == 'approved':
            complaint = models.get_complaint_by_id(complaint_id)
            if complaint and complaint['requested_time']:
                # Xử lý cập nhật lịch sử chấm công theo thời gian yêu cầu
                # Tùy thuộc vào logic nghiệp vụ của bạn
                pass
        
        return jsonify({'success': True, 'message': f'Đơn khiếu nại đã được {status}'})
    except Exception as e:
        print(f"Lỗi khi xử lý đơn khiếu nại: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/logout')
def logout():
    """Đăng xuất admin"""
    # Xóa session hoặc cookie nếu có
    return redirect(url_for('index'))

@app.route('/employee-status/<int:employee_id>')
def get_employee_status(employee_id):
    """API endpoint để kiểm tra trạng thái chấm công của nhân viên"""
    try:
        conn = models.get_db_connection()
        today_record = conn.execute('''
            SELECT * FROM attendance 
            WHERE employee_id = ? AND date(check_in_time) = date('now')
            ORDER BY check_in_time DESC LIMIT 1
        ''', (employee_id,)).fetchone()
        
        conn.close()
        
        if today_record:
            return jsonify({
                'checked_in': True,
                'check_in_time': today_record['check_in_time'],
                'checked_out': today_record['check_out_time'] is not None,
                'check_out_time': today_record['check_out_time']
            })
        else:
            return jsonify({
                'checked_in': False,
                'checked_out': False
            })
    except Exception as e:
        print(f"Lỗi khi kiểm tra trạng thái nhân viên: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/today-attendance')
def get_today_attendance():
    """API endpoint lấy danh sách chấm công trong ngày"""
    try:
        conn = models.get_db_connection()
        today_records = conn.execute('''
            SELECT a.*, e.name, e.employee_code, e.profile_image
            FROM attendance a
            JOIN employee e ON a.employee_id = e.id
            WHERE date(a.check_in_time) = date('now')
            ORDER BY a.last_updated DESC
        ''').fetchall()
        
        conn.close()
        
        result = []
        for record in today_records:
            result.append({
                'id': record['id'],
                'employee_id': record['employee_id'],
                'name': record['name'],
                'employee_code': record['employee_code'],
                'profile_image': record['profile_image'],
                'check_in_time': record['check_in_time'],
                'check_out_time': record['check_out_time'],
                'work_duration': record['work_duration'] if record['work_duration'] else None
            })
            
        return jsonify(result)
    except Exception as e:
        print(f"Lỗi khi lấy danh sách chấm công trong ngày: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/get-employee-by-code/<employee_code>')
def get_employee_by_code(employee_code):
    """API endpoint lấy thông tin nhân viên theo mã"""
    try:
        employee = models.get_employee_by_code(employee_code)
        if employee:
            return jsonify({
                'success': True,
                'employee': {
                    'id': employee['id'],
                    'name': employee['name'],
                    'position': employee['position']
                }
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Không tìm thấy nhân viên'
            })
    except Exception as e:
        print(f"Lỗi khi lấy thông tin nhân viên: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/detection-status')
def get_detection_status():
    """API endpoint lấy trạng thái nhận diện hiện tại"""
    global current_confidence, face_detected, detected_employee
    return jsonify({
        'face_detected': face_detected,
        'confidence': current_confidence,
        'employee': detected_employee.get('name', None) if detected_employee else None
    })

@app.route('/capture-raw-frame')
def capture_raw_frame():
    """Chụp frame từ camera không có bounding box"""
    global camera
    
    if not camera or not camera.isOpened():
        if not init_camera():
            return Response('Không thể kết nối camera', status=500)
    
    with camera_lock:
        ret, frame = camera.read()
        
    if not ret:
        return Response('Không thể đọc frame từ camera', status=500)
    
    # Chuyển frame thành ảnh JPEG
    ret, buffer = cv2.imencode('.jpg', frame)
    if not ret:
        return Response('Không thể tạo ảnh JPEG', status=500)
    
    # Trả về ảnh dạng response
    return Response(buffer.tobytes(), mimetype='image/jpeg')

if __name__ == '__main__':
    app.run(debug=True)
