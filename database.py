import sqlite3
import numpy as np
import cv2
import mediapipe as mp
from datetime import datetime
import os
import pickle
import base64
from flask_sqlalchemy import SQLAlchemy

# Khởi tạo SQLAlchemy mà không cần Flask app
db = SQLAlchemy()

# Định nghĩa model Employee
class Employee(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.String(50), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    face_embedding = db.Column(db.PickleType)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# Khởi tạo MediaPipe Face Detection
mp_face_detection = mp.solutions.face_detection
mp_face_mesh = mp.solutions.face_mesh
face_detection = mp_face_detection.FaceDetection(
    model_selection=0,
    min_detection_confidence=0.5
)
face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5
)

def get_db_connection():
    """Tạo kết nối database"""
    conn = sqlite3.connect('attendance.db')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Khởi tạo database và tạo các bảng cần thiết"""
    conn = get_db_connection()
    
    # Tạo bảng employees
    conn.execute('''
        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Tạo bảng attendance
    conn.execute('''
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id TEXT NOT NULL,
            check_in_time TIMESTAMP NOT NULL,
            check_out_time TIMESTAMP,
            status TEXT DEFAULT 'on_time',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees (employee_id)
        )
    ''')
    
    # Tạo bảng embeddings
    conn.execute('''
        CREATE TABLE IF NOT EXISTS embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id TEXT NOT NULL,
            embedding BLOB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees (employee_id)
        )
    ''')
    
    conn.commit()
    conn.close()

def process_image(image_data):
    """Xử lý ảnh và tạo embedding"""
    try:
        # Chuyển base64 thành numpy array
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Chuyển sang RGB cho MediaPipe
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        
        # Phát hiện khuôn mặt
        results = face_detection.process(img_rgb)
        if not results.detections:
            return None
            
        # Lấy khuôn mặt đầu tiên với độ tin cậy cao nhất
        detection = max(results.detections, key=lambda d: d.score[0])
        bbox = detection.location_data.relative_bounding_box
        
        # Cắt khuôn mặt
        h, w = img.shape[:2]
        x = int(bbox.xmin * w)
        y = int(bbox.ymin * h)
        width = int(bbox.width * w)
        height = int(bbox.height * h)
        face = img[y:y+height, x:x+width]
        
        # Resize về kích thước chuẩn 160x160
        face = cv2.resize(face, (160, 160))
        
        # Tạo embedding từ face mesh trước khi chuẩn hóa
        face_rgb = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
        mesh_results = face_mesh.process(face_rgb)
        
        if not mesh_results.multi_face_landmarks:
            return None
            
        # Lấy landmarks và tạo embedding
        landmarks = mesh_results.multi_face_landmarks[0]
        embedding = np.array([[lm.x, lm.y, lm.z] for lm in landmarks.landmark]).flatten()
        
        # Chuẩn hóa embedding
        embedding = embedding.astype(np.float32)
        embedding = embedding / np.linalg.norm(embedding)
        
        return embedding
        
    except Exception as e:
        print(f"Lỗi xử lý ảnh: {str(e)}")
        return None

def save_embeddings(employee_id, images):
    """Lưu embeddings vào database"""
    conn = get_db_connection()
    try:
        for image_data in images:
            # Xử lý ảnh và tạo embedding
            embedding = process_image(image_data)
            if embedding is not None:
                # Chuyển embedding thành bytes để lưu vào SQLite
                embedding_bytes = pickle.dumps(embedding)
                
                # Lưu vào database
                conn.execute('''
                    INSERT INTO embeddings (employee_id, embedding)
                    VALUES (?, ?)
                ''', (employee_id, embedding_bytes))
        
        conn.commit()
        return True, "Lưu embeddings thành công"
    except Exception as e:
        return False, str(e)
    finally:
        conn.close()

def get_embeddings(employee_id):
    """Lấy embeddings của nhân viên"""
    conn = get_db_connection()
    try:
        cursor = conn.execute('''
            SELECT embedding FROM embeddings
            WHERE employee_id = ?
        ''', (employee_id,))
        
        embeddings = []
        for row in cursor:
            embedding = pickle.loads(row['embedding'])
            embeddings.append(embedding)
            
        return embeddings
    finally:
        conn.close()

def compare_faces(face_embedding, threshold=0.6):
    """So sánh khuôn mặt với database"""
    conn = get_db_connection()
    try:
        cursor = conn.execute('''
            SELECT e.employee_id, emp.name, e.embedding
            FROM embeddings e
            JOIN employees emp ON e.employee_id = emp.employee_id
        ''')
        
        best_match = None
        best_distance = float('inf')
        
        for row in cursor:
            stored_embedding = pickle.loads(row['embedding'])
            distance = np.linalg.norm(face_embedding - stored_embedding)
            
            if distance < best_distance:
                best_distance = distance
                best_match = {
                    'employee_id': row['employee_id'],
                    'name': row['name'],
                    'distance': distance
                }
        
        if best_match and best_match['distance'] < threshold:
            return best_match
        return None
        
    finally:
        conn.close()

def add_attendance(employee_id, check_in_time=None, check_out_time=None):
    """Thêm hoặc cập nhật bản ghi chấm công"""
    conn = get_db_connection()
    try:
        if check_in_time:
            # Kiểm tra xem đã có check in hôm nay chưa
            today = datetime.now().strftime('%Y-%m-%d')
            existing = conn.execute('''
                SELECT * FROM attendance 
                WHERE employee_id = ? AND DATE(check_in_time) = ?
            ''', (employee_id, today)).fetchone()
            
            if existing:
                return False, "Đã check in hôm nay"
            
            # Thêm bản ghi check in mới
            conn.execute('''
                INSERT INTO attendance (employee_id, check_in_time)
                VALUES (?, ?)
            ''', (employee_id, check_in_time))
            
        elif check_out_time:
            # Cập nhật check out cho bản ghi gần nhất chưa check out
            conn.execute('''
                UPDATE attendance 
                SET check_out_time = ?
                WHERE employee_id = ? 
                AND check_out_time IS NULL
                ORDER BY check_in_time DESC
                LIMIT 1
            ''', (check_out_time, employee_id))
            
        conn.commit()
        return True, "Thành công"
    except Exception as e:
        return False, str(e)
    finally:
        conn.close()

def get_attendance_history(date=None, employee_id=None, page=1, per_page=10):
    """Lấy lịch sử chấm công với phân trang và lọc"""
    conn = get_db_connection()
    try:
        query = '''
            SELECT a.*, e.name 
            FROM attendance a
            JOIN employees e ON a.employee_id = e.employee_id
            WHERE 1=1
        '''
        params = []
        
        if date:
            query += " AND DATE(a.check_in_time) = ?"
            params.append(date)
            
        if employee_id:
            query += " AND a.employee_id = ?"
            params.append(employee_id)
            
        # Tính offset cho phân trang
        offset = (page - 1) * per_page
        
        # Lấy tổng số bản ghi
        count_query = f"SELECT COUNT(*) as total FROM ({query})"
        total = conn.execute(count_query, params).fetchone()['total']
        
        # Lấy dữ liệu phân trang
        query += " ORDER BY a.check_in_time DESC LIMIT ? OFFSET ?"
        params.extend([per_page, offset])
        
        records = conn.execute(query, params).fetchall()
        
        return {
            'records': records,
            'total': total,
            'pages': (total + per_page - 1) // per_page,
            'current_page': page
        }
    finally:
        conn.close()

def export_attendance_report(start_date, end_date):
    """Xuất báo cáo chấm công theo khoảng thời gian"""
    conn = get_db_connection()
    try:
        query = '''
            SELECT 
                e.employee_id,
                e.name,
                COUNT(DISTINCT DATE(a.check_in_time)) as total_days,
                MIN(a.check_in_time) as first_check_in,
                MAX(a.check_out_time) as last_check_out,
                AVG(ROUND((JULIANDAY(a.check_out_time) - JULIANDAY(a.check_in_time)) * 24, 2)) as avg_hours
            FROM employees e
            LEFT JOIN attendance a ON e.employee_id = a.employee_id
            WHERE DATE(a.check_in_time) BETWEEN ? AND ?
            GROUP BY e.employee_id, e.name
            ORDER BY e.employee_id
        '''
        
        return conn.execute(query, (start_date, end_date)).fetchall()
    finally:
        conn.close()

def add_employee(employee_id, name, images):
    """Thêm nhân viên mới với ảnh khuôn mặt"""
    try:
        # Kiểm tra nhân viên đã tồn tại
        existing_employee = Employee.query.filter_by(employee_id=employee_id).first()
        if existing_employee:
            return False, "Mã nhân viên đã tồn tại"
            
        # Xử lý từng ảnh và tạo embedding
        embeddings = []
        for image_data in images:
            # Chuyển base64 thành bytes
            image_bytes = base64.b64decode(image_data)
            
            # Xử lý ảnh và tạo embedding
            embedding = process_image(image_bytes)
            if embedding is None:
                return False, "Không thể phát hiện khuôn mặt trong ảnh"
            embeddings.append(embedding)
            
        # Tính embedding trung bình
        avg_embedding = np.mean(embeddings, axis=0)
        
        # Tạo nhân viên mới
        new_employee = Employee(
            employee_id=employee_id,
            name=name,
            face_embedding=avg_embedding.tolist()
        )
        
        db.session.add(new_employee)
        db.session.commit()
        
        return True, "Đăng ký thành công"
        
    except Exception as e:
        db.session.rollback()
        print(f"Lỗi khi thêm nhân viên: {str(e)}")
        return False, f"Lỗi: {str(e)}"

def get_employees(search=None):
    """Lấy danh sách nhân viên với tìm kiếm"""
    try:
        query = Employee.query
        if search:
            query = query.filter(
                db.or_(
                    Employee.employee_id.like(f"%{search}%"),
                    Employee.name.like(f"%{search}%")
                )
            )
        employees = query.order_by(Employee.employee_id).all()
        return [
            {
                'employee_id': emp.employee_id,
                'name': emp.name,
                'created_at': emp.created_at
            } for emp in employees
        ]
    except Exception as e:
        print(f"Lỗi khi lấy danh sách nhân viên: {str(e)}")
        return []

def update_employee(employee_id, name):
    """Cập nhật thông tin nhân viên"""
    conn = get_db_connection()
    try:
        conn.execute('''
            UPDATE employees 
            SET name = ?
            WHERE employee_id = ?
        ''', (name, employee_id))
        conn.commit()
        return True, "Cập nhật thành công"
    except Exception as e:
        return False, str(e)
    finally:
        conn.close()

def delete_employee(employee_id):
    """Xóa nhân viên"""
    try:
        # Tìm nhân viên cần xóa
        employee = Employee.query.filter_by(employee_id=employee_id).first()
        if not employee:
            return False, "Không tìm thấy nhân viên"
            
        # Xóa nhân viên
        db.session.delete(employee)
        db.session.commit()
        return True, "Xóa thành công"
    except Exception as e:
        db.session.rollback()
        print(f"Lỗi khi xóa nhân viên: {str(e)}")
        return False, str(e)

def get_attendance_stats(start_date, end_date):
    """Lấy dữ liệu thống kê cho biểu đồ"""
    conn = get_db_connection()
    try:
        query = '''
            SELECT 
                DATE(a.check_in_time) as date,
                COUNT(DISTINCT a.employee_id) as total_employees,
                COUNT(DISTINCT CASE WHEN a.check_out_time IS NOT NULL THEN a.employee_id END) as checked_out,
                AVG(ROUND((JULIANDAY(a.check_out_time) - JULIANDAY(a.check_in_time)) * 24, 2)) as avg_hours
            FROM attendance a
            WHERE DATE(a.check_in_time) BETWEEN ? AND ?
            GROUP BY DATE(a.check_in_time)
            ORDER BY date
        '''
        
        return conn.execute(query, (start_date, end_date)).fetchall()
    finally:
        conn.close()

def save_complaint(employee_id, reason, note, image):
    """Lưu khiếu nại vào database"""
    conn = get_db_connection()
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS complaints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id TEXT NOT NULL,
                reason TEXT NOT NULL,
                note TEXT,
                image TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (employee_id) REFERENCES employees (employee_id)
            )
        ''')
        
        conn.execute('''
            INSERT INTO complaints (employee_id, reason, note, image)
            VALUES (?, ?, ?, ?)
        ''', (employee_id, reason, note, image))
        
        conn.commit()
        return True, "Gửi khiếu nại thành công"
    except Exception as e:
        return False, str(e)
    finally:
        conn.close()

def get_complaints():
    """Lấy danh sách khiếu nại"""
    conn = get_db_connection()
    try:
        return conn.execute('''
            SELECT c.*, e.name as employee_name
            FROM complaints c
            JOIN employees e ON c.employee_id = e.employee_id
            ORDER BY c.created_at DESC
        ''').fetchall()
    finally:
        conn.close()

def get_complaint_by_id(complaint_id):
    """Lấy chi tiết khiếu nại theo ID"""
    conn = get_db_connection()
    try:
        return conn.execute('''
            SELECT c.*, e.name as employee_name
            FROM complaints c
            JOIN employees e ON c.employee_id = e.employee_id
            WHERE c.id = ?
        ''', (complaint_id,)).fetchone()
    finally:
        conn.close()

def update_complaint_status(complaint_id, status):
    """Cập nhật trạng thái khiếu nại"""
    conn = get_db_connection()
    try:
        conn.execute('''
            UPDATE complaints
            SET status = ?
            WHERE id = ?
        ''', (status, complaint_id))
        conn.commit()
        return True, "Cập nhật thành công"
    except Exception as e:
        return False, str(e)
    finally:
        conn.close()

def reset_daily_attendance():
    """Reset dữ liệu chấm công hàng ngày"""
    conn = get_db_connection()
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        conn.execute('''
            DELETE FROM attendance 
            WHERE DATE(check_in_time) = ?
        ''', (today,))
        conn.commit()
        return True, "Reset dữ liệu thành công"
    except Exception as e:
        return False, str(e)
    finally:
        conn.close()

def recognize_face(image_data):
    """Nhận diện khuôn mặt từ ảnh"""
    try:
        # Chuyển base64 thành bytes
        image_bytes = base64.b64decode(image_data)
        
        # Xử lý ảnh và tạo embedding
        embedding = process_image(image_bytes)
        if embedding is None:
            print("Không thể tạo embedding từ ảnh")
            return None, 0.0
            
        # Lấy tất cả nhân viên
        employees = Employee.query.all()
        if not employees:
            print("Không có nhân viên nào trong database")
            return None, 0.0
            
        # So sánh với embedding của từng nhân viên
        best_match = None
        best_similarity = 0.0
        
        for employee in employees:
            if employee.face_embedding:
                # Chuyển embedding từ list về numpy array
                stored_embedding = np.array(employee.face_embedding)
                
                # Chuẩn hóa cả 2 embedding
                embedding = embedding / np.linalg.norm(embedding)
                stored_embedding = stored_embedding / np.linalg.norm(stored_embedding)
                
                # Tính cosine similarity
                similarity = np.dot(embedding, stored_embedding)
                print(f"Similarity với {employee.name}: {similarity}")
                
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_match = employee
        
        # Chỉ trả về kết quả nếu độ tương đồng > 0.7
        if best_similarity > 0.7:
            print(f"Tìm thấy khuôn mặt khớp: {best_match.name} với độ tương đồng {best_similarity}")
            return best_match, best_similarity
            
        print(f"Không tìm thấy khuôn mặt khớp. Độ tương đồng cao nhất: {best_similarity}")
        return None, best_similarity
        
    except Exception as e:
        print(f"Lỗi khi nhận diện khuôn mặt: {str(e)}")
        return None, 0.0 