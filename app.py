from flask import Flask, Response, render_template, jsonify, request, url_for, send_file
import cv2
import time
import threading
import os
from gtts import gTTS
from io import BytesIO
import mediapipe as mp
from datetime import datetime
from database import init_db, add_attendance, get_attendance_history, export_attendance_report, add_employee, get_employees, update_employee, delete_employee, get_attendance_stats, save_complaint, get_complaints, get_complaint_by_id, update_complaint_status, save_embeddings, compare_faces, reset_daily_attendance, db
import json
import numpy as np

# Tắt các warning không cần thiết
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

app = Flask(__name__)

# Cấu hình SQLAlchemy
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///attendance.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Khởi tạo SQLAlchemy với app
db.init_app(app)

# Tạo tất cả bảng trong database
with app.app_context():
    db.create_all()

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
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5
)

# Biến theo dõi trạng thái
current_confidence = 0.0
face_detected = False
last_detection_time = 0
detection_status = "Chưa phát hiện"

# Khởi tạo database khi khởi động ứng dụng
init_db()

def init_camera():
    """Khởi tạo và kiểm tra camera"""
    global camera
    try:
        if camera is None:
            # Tắt các warning không cần thiết
            os.environ['OPENCV_VIDEOIO_DEBUG'] = '0'
            os.environ['OPENCV_VIDEOIO_PRIORITY_BACKEND'] = '0'
            
            camera = cv2.VideoCapture(0)
            
            # Tối ưu cài đặt camera
            camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Giảm buffer size
            camera.set(cv2.CAP_PROP_FPS, 30)  # Tăng FPS
            camera.set(cv2.CAP_PROP_AUTOFOCUS, 0)  # Tắt autofocus
            camera.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)  # Tắt auto exposure
            camera.set(cv2.CAP_PROP_SETTINGS, 1)
            
            # Đọc frame đầu tiên để khởi tạo camera
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

def process_frame(frame, show_bounding_box=True):
    """Xử lý frame với MediaPipe Face Detection và VGG Face"""
    global current_confidence, face_detected, last_detection_time
    
    try:
        # Lật ngược frame để hiển thị đúng hướng
        frame = cv2.flip(frame, 1)
        
        # Chuyển frame sang RGB vì MediaPipe yêu cầu đầu vào là RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = face_detection.process(frame_rgb)
        
        if results.detections:
            face_detected = True
            detection = results.detections[0]  # Lấy khuôn mặt đầu tiên
            current_confidence = detection.score[0]
            last_detection_time = time.time()
            
            # Vẽ khuôn mặt nếu show_bounding_box=True
            if show_bounding_box:
                bbox = detection.location_data.relative_bounding_box
                h, w, _ = frame.shape
                x = int(bbox.xmin * w)
                y = int(bbox.ymin * h)
                width = int(bbox.width * w)
                height = int(bbox.height * h)
                
                # Cắt khuôn mặt và tạo embedding
                face = frame[y:y+height, x:x+width]
                face = cv2.resize(face, (224, 224))
                face_rgb = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
                
                # Sử dụng VGG Face để xác định khuôn mặt
                mesh_results = face_mesh.process(face_rgb)
                if mesh_results.multi_face_landmarks:
                    landmarks = mesh_results.multi_face_landmarks[0]
                    embedding = np.array([[lm.x, lm.y, lm.z] for lm in landmarks.landmark]).flatten()
                    
                    # So sánh với database
                    match = compare_faces(embedding)
                    if match:
                        print(f"Đã nhận diện: {match['name']} (ID: {match['employee_id']})")
                        # Vẽ rectangle màu xanh nếu nhận diện được
                        cv2.rectangle(frame, (x, y), (x + width, y + height), (0, 255, 0), 2)
                        # Thêm tên người dùng
                        cv2.putText(frame, match['name'], (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                    else:
                        # Vẽ rectangle màu đỏ nếu không nhận diện được
                        cv2.rectangle(frame, (x, y), (x + width, y + height), (0, 0, 255), 2)
                        cv2.putText(frame, "Không nhận diện được", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
                else:
                    # Vẽ rectangle màu vàng nếu không có landmarks
                    cv2.rectangle(frame, (x, y), (x + width, y + height), (0, 255, 255), 2)
                    cv2.putText(frame, "Không phát hiện landmarks", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 2)
        else:
            face_detected = False
            current_confidence = 0.0
                
    except Exception as e:
        print(f"Lỗi khi xử lý frame: {str(e)}")
        face_detected = False
        current_confidence = 0.0
        
    return frame

def generate_frames(show_bounding_box=True):
    """Generator để stream video"""
    global camera, camera_running
    
    if not init_camera():
        return
        
    camera_running = True
    while camera_running:
        try:
            with camera_lock:
                success, frame = camera.read()
                if not success:
                    break
                    
                # Xử lý frame
                frame = process_frame(frame, show_bounding_box)
                
                # Chuyển frame thành jpg
                ret, buffer = cv2.imencode('.jpg', frame)
                frame = buffer.tobytes()
                
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
                   
        except Exception as e:
            print(f"Lỗi khi generate frame: {str(e)}")
            break
            
    release_camera()

def release_camera():
    """Giải phóng camera"""
    global camera
    with camera_lock:
        if camera is not None:
            camera.release()
            camera = None

@app.route('/')
def index():
    """Trang chủ"""
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    """Video stream route"""
    try:
        if not init_camera():
            return "Camera error", 500
            
        # Đọc tham số show_bounding_box từ query string, mặc định là True
        show_bounding_box = request.args.get('show_bounding_box', 'true').lower() == 'true'
        
        return Response(generate_frames(show_bounding_box),
                       mimetype='multipart/x-mixed-replace; boundary=frame')
    except Exception as e:
        print(f"Lỗi stream video: {str(e)}")
        return "Video stream error", 500

@app.route('/status')
def get_status():
    """API endpoint để lấy trạng thái hiện tại"""
    current_time = time.strftime("%H:%M:%S")
    return jsonify({
        "time": current_time,
        "confidence": current_confidence,
        "face_detected": face_detected  # Chỉ cần trả về trạng thái phát hiện
    })

@app.route('/tts', methods=['POST'])
def text_to_speech():
    """API endpoint để tạo và phát audio trực tiếp từ text"""
    data = request.get_json()
    text = data.get('text', '')
    
    if not text:
        return jsonify({'error': 'No text provided'}), 400
    
    try:
        # Tạo audio trong memory buffer thay vì lưu file
        mp3_fp = BytesIO()
        tts = gTTS(text=text, lang='vi')
        tts.write_to_fp(mp3_fp)
        mp3_fp.seek(0)
        
        # Trả về audio stream trực tiếp
        return send_file(
            mp3_fp,
            mimetype='audio/mpeg',
            as_attachment=True,
            download_name='speech.mp3'
        )
    except Exception as e:
        print(f"Lỗi khi tạo audio: {str(e)}")
        return jsonify({'error': 'Lỗi khi tạo audio'}), 500

@app.route('/api/attendance/check-in', methods=['POST'])
def check_in():
    """API check in"""
    try:
        data = request.get_json()
        employee_id = data.get('employee_id')
        check_in_time = datetime.now()
        
        success, message = add_attendance(employee_id, check_in_time=check_in_time)
        if success:
            return jsonify({
                'success': True,
                'message': message,
                'data': {
                    'employee_id': employee_id,
                    'check_in_time': check_in_time.strftime('%Y-%m-%d %H:%M:%S')
                }
            })
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/attendance/check-out', methods=['POST'])
def check_out():
    """API check out"""
    try:
        data = request.get_json()
        employee_id = data.get('employee_id')
        check_out_time = datetime.now()
        
        success, message = add_attendance(employee_id, check_out_time=check_out_time)
        if success:
            return jsonify({
                'success': True,
                'message': message,
                'data': {
                    'employee_id': employee_id,
                    'check_out_time': check_out_time.strftime('%Y-%m-%d %H:%M:%S')
                }
            })
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/attendance/history')
def get_history():
    """API lấy lịch sử chấm công"""
    try:
        date = request.args.get('date')
        employee_id = request.args.get('employee_id')
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 10))
        
        result = get_attendance_history(date, employee_id, page, per_page)
        return jsonify(result)
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/attendance/export')
def export_report():
    """API xuất báo cáo"""
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        if not start_date or not end_date:
            return jsonify({
                'success': False,
                'message': 'Thiếu thông tin ngày bắt đầu hoặc kết thúc'
            }), 400
            
        records = export_attendance_report(start_date, end_date)
        
        # Chuyển đổi kết quả thành list dict
        data = []
        for record in records:
            data.append({
                'employee_id': record['employee_id'],
                'name': record['name'],
                'total_days': record['total_days'],
                'first_check_in': record['first_check_in'],
                'last_check_out': record['last_check_out'],
                'avg_hours': round(record['avg_hours'], 2) if record['avg_hours'] else 0
            })
            
        return jsonify({
            'success': True,
            'data': data
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/employees', methods=['GET'])
def get_employees_list():
    """API lấy danh sách nhân viên"""
    try:
        search = request.args.get('search')
        employees = get_employees(search)
        return jsonify({
            'success': True,
            'data': [dict(emp) for emp in employees]
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/employees', methods=['POST'])
def add_new_employee():
    """API thêm nhân viên mới"""
    try:
        data = request.get_json()
        employee_id = data.get('employee_id')
        name = data.get('name')
        
        if not employee_id or not name:
            return jsonify({
                'success': False,
                'message': 'Thiếu thông tin nhân viên'
            }), 400
            
        success, message = add_employee(employee_id, name)
        if success:
            return jsonify({
                'success': True,
                'message': message
            })
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/employees/<employee_id>', methods=['PUT'])
def update_employee_info(employee_id):
    """API cập nhật thông tin nhân viên"""
    try:
        data = request.get_json()
        name = data.get('name')
        
        if not name:
            return jsonify({
                'success': False,
                'message': 'Thiếu tên nhân viên'
            }), 400
            
        success, message = update_employee(employee_id, name)
        if success:
            return jsonify({
                'success': True,
                'message': message
            })
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/employees/<employee_id>', methods=['DELETE'])
def delete_employee_info(employee_id):
    """API xóa nhân viên"""
    try:
        success, message = delete_employee(employee_id)
        if success:
            return jsonify({
                'success': True,
                'message': message
            })
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/attendance/stats')
def get_attendance_stats():
    """API lấy dữ liệu thống kê"""
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        if not start_date or not end_date:
            return jsonify({
                'success': False,
                'message': 'Thiếu thông tin ngày bắt đầu hoặc kết thúc'
            }), 400
            
        stats = get_attendance_stats(start_date, end_date)
        return jsonify({
            'success': True,
            'data': [dict(stat) for stat in stats]
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/admin')
def admin():
    """Trang quản trị"""
    return render_template('admin.html')

@app.route('/api/complaints', methods=['POST'])
def submit_complaint():
    """API gửi khiếu nại"""
    try:
        data = request.get_json()
        employee_id = data.get('employee_id')
        reason = data.get('reason')
        note = data.get('note')
        image = data.get('image')
        
        # Lưu khiếu nại vào database
        success, message = save_complaint(employee_id, reason, note, image)
        
        if success:
            return jsonify({
                'success': True,
                'message': message
            })
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/complaints')
def get_complaints():
    """API lấy danh sách khiếu nại"""
    try:
        complaints = get_complaints()
        return jsonify({
            'success': True,
            'complaints': [dict(complaint) for complaint in complaints]
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/complaints/<int:complaint_id>')
def get_complaint_detail(complaint_id):
    """API lấy chi tiết khiếu nại"""
    try:
        complaint = get_complaint_by_id(complaint_id)
        if complaint:
            return jsonify({
                'success': True,
                'complaint': dict(complaint)
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Không tìm thấy khiếu nại'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/complaints/<int:complaint_id>/approve', methods=['POST'])
def approve_complaint(complaint_id):
    """API duyệt khiếu nại"""
    try:
        success, message = update_complaint_status(complaint_id, 'approved')
        if success:
            return jsonify({
                'success': True,
                'message': message
            })
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/complaints/<int:complaint_id>/reject', methods=['POST'])
def reject_complaint(complaint_id):
    """API từ chối khiếu nại"""
    try:
        success, message = update_complaint_status(complaint_id, 'rejected')
        if success:
            return jsonify({
                'success': True,
                'message': message
            })
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/register_employee')
def register_employee():
    return render_template('register_employee.html')

@app.route('/api/employees/register', methods=['POST'])
def register_new_employee():
    try:
        data = request.get_json()
        employee_id = data.get('employee_id')
        name = data.get('name')
        images = data.get('images', [])
        
        if not employee_id or not name or not images:
            return jsonify({
                'success': False,
                'message': 'Thiếu thông tin nhân viên hoặc ảnh'
            }), 400
            
        # Lưu thông tin nhân viên và xử lý ảnh
        success, message = add_employee(employee_id, name, images)
        if success:
            return jsonify({
                'success': True,
                'message': message
            })
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/api/attendance/reset', methods=['POST'])
def reset_attendance():
    """API reset dữ liệu chấm công"""
    try:
        success, message = reset_daily_attendance()
        if success:
            return jsonify({
                'success': True,
                'message': message
            })
        else:
            return jsonify({
                'success': False,
                'message': message
            }), 500
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True)
