import sqlite3
from datetime import datetime

DB_PATH = 'attendance.db'

def get_db_connection():
    """Tạo kết nối đến SQLite database"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # Để trả về dict thay vì tuple
    return conn

def init_db():
    """Khởi tạo database với các bảng cần thiết"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Bảng Employee - thêm trường position
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS employee (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        position TEXT,
        face_encoding BLOB,
        profile_image TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    # Kiểm tra xem cột position đã tồn tại chưa
    cursor.execute("PRAGMA table_info(employee)")
    columns = [column[1] for column in cursor.fetchall()]
    
    # Nếu chưa có cột position, thêm vào
    if 'position' not in columns:
        cursor.execute('ALTER TABLE employee ADD COLUMN position TEXT')
    
    # Bảng Attendance
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        check_in_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        check_out_time TIMESTAMP,
        work_duration INTEGER,
        status TEXT DEFAULT 'checked_in',
        photo_path TEXT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employee (id)
    )
    ''')
    
    # Bảng Complaint
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS complaint (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        complaint_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        photo TEXT,
        reason TEXT NOT NULL,
        details TEXT,
        requested_time TIMESTAMP,
        status TEXT DEFAULT 'pending',
        processed_by INTEGER,
        processed_time TIMESTAMP,
        admin_note TEXT,
        FOREIGN KEY (employee_id) REFERENCES employee (id),
        FOREIGN KEY (processed_by) REFERENCES employee (id)
    )
    ''')
    
    # Bảng CheckLog
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS check_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        check_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        check_type TEXT,
        photo TEXT,
        attendance_id INTEGER,
        FOREIGN KEY (employee_id) REFERENCES employee (id),
        FOREIGN KEY (attendance_id) REFERENCES attendance (id)
    )
    ''')
    
    conn.commit()
    conn.close()

# Các hàm thao tác với Employee
def get_all_employees():
    """Lấy danh sách tất cả nhân viên"""
    conn = get_db_connection()
    employees = conn.execute('SELECT * FROM employee').fetchall()
    conn.close()
    return [dict(e) for e in employees]

def get_employee_by_id(employee_id):
    """Lấy thông tin nhân viên theo ID"""
    conn = get_db_connection()
    employee = conn.execute('SELECT * FROM employee WHERE id = ?', (employee_id,)).fetchone()
    conn.close()
    return dict(employee) if employee else None

def get_employee_by_code(employee_code):
    """Lấy thông tin nhân viên theo mã nhân viên"""
    conn = get_db_connection()
    employee = conn.execute('SELECT * FROM employee WHERE employee_code = ?', (employee_code,)).fetchone()
    conn.close()
    return dict(employee) if employee else None

def add_employee(employee_data):
    """Thêm nhân viên mới"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO employee (employee_code, name, profile_image) VALUES (?, ?, ?)',
        (employee_data['employee_code'], employee_data['name'], employee_data.get('profile_image'))
    )
    employee_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return employee_id

# Các hàm thao tác với Attendance
def get_today_attendance(employee_id):
    """Lấy bản ghi chấm công của ngày hôm nay cho nhân viên"""
    today = datetime.now().strftime('%Y-%m-%d')
    conn = get_db_connection()
    attendance = conn.execute(
        'SELECT * FROM attendance WHERE employee_id = ? AND date(check_in_time) = ?', 
        (employee_id, today)
    ).fetchone()
    conn.close()
    return dict(attendance) if attendance else None

def get_active_employees():
    """Lấy danh sách nhân viên đang làm việc"""
    conn = get_db_connection()
    query = '''
    SELECT e.*, a.id as attendance_id, a.check_in_time, a.status
    FROM employee e
    JOIN attendance a ON e.id = a.employee_id
    WHERE a.status = 'checked_in' AND a.check_out_time IS NULL
    '''
    active_records = conn.execute(query).fetchall()
    conn.close()
    
    result = []
    now = datetime.now()
    for record in active_records:
        record_dict = dict(record)
        check_in_time = datetime.fromisoformat(record_dict['check_in_time'])
        duration_seconds = int((now - check_in_time).total_seconds())
        hours = duration_seconds // 3600
        minutes = (duration_seconds % 3600) // 60
        
        record_dict['work_duration'] = f"{hours} giờ {minutes} phút"
        result.append(record_dict)
    
    return result

def add_or_update_attendance(employee_id, check_time, photo_path=None):
    """Thêm hoặc cập nhật bản ghi chấm công"""
    conn = get_db_connection()
    now = datetime.now().isoformat()
    
    # Kiểm tra xem nhân viên đã chấm công hôm nay chưa
    today_record = conn.execute('''
        SELECT * FROM attendance
        WHERE employee_id = ? AND date(check_in_time) = date('now')
    ''', (employee_id,)).fetchone()
    
    result = {}
    
    if today_record:
        # Đã có chấm công -> cập nhật check_out
        work_duration = None
        if today_record['check_in_time']:
            check_in_time = datetime.fromisoformat(today_record['check_in_time'])
            check_time_dt = datetime.fromisoformat(check_time)
            work_duration = int((check_time_dt - check_in_time).total_seconds())
        
        conn.execute('''
            UPDATE attendance
            SET check_out_time = ?, work_duration = ?, last_updated = ?
            WHERE id = ?
        ''', (check_time, work_duration, now, today_record['id']))
        
        # Thêm log chấm công
        conn.execute('''
            INSERT INTO check_log (employee_id, attendance_id, check_time, photo_path, type)
            VALUES (?, ?, ?, ?, ?)
        ''', (employee_id, today_record['id'], check_time, photo_path, 'check_out'))
        
        result = {
            'message': 'Đã cập nhật giờ check-out',
            'is_check_in': False,
            'check_time': check_time,
            'work_duration': work_duration
        }
    else:
        # Chưa có chấm công -> tạo mới với check_in
        cursor = conn.execute('''
            INSERT INTO attendance (employee_id, check_in_time, last_updated)
            VALUES (?, ?, ?)
        ''', (employee_id, check_time, now))
        
        attendance_id = cursor.lastrowid
        
        # Thêm log chấm công
        conn.execute('''
            INSERT INTO check_log (employee_id, attendance_id, check_time, photo_path, type)
            VALUES (?, ?, ?, ?, ?)
        ''', (employee_id, attendance_id, check_time, photo_path, 'check_in'))
        
        result = {
            'message': 'Đã ghi nhận giờ check-in',
            'is_check_in': True,
            'check_time': check_time
        }
    
    conn.commit()
    conn.close()
    
    return result

# Các hàm thao tác với Complaint
def add_complaint(complaint_data):
    """Thêm đơn khiếu nại mới"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO complaint (employee_id, photo, reason, details, requested_time) VALUES (?, ?, ?, ?, ?)',
        (
            complaint_data['employee_id'], 
            complaint_data.get('photo'), 
            complaint_data['reason'], 
            complaint_data.get('details'),
            complaint_data.get('requested_time')
        )
    )
    complaint_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return complaint_id

def get_all_complaints():
    """Lấy tất cả các đơn khiếu nại"""
    conn = get_db_connection()
    complaints = conn.execute('''
        SELECT c.*, e.name as employee_name, e.employee_code
        FROM complaint c
        JOIN employee e ON c.employee_id = e.id
        ORDER BY c.complaint_time DESC
    ''').fetchall()
    conn.close()
    return [dict(c) for c in complaints]

def get_complaint_by_id(complaint_id):
    """Lấy thông tin đơn khiếu nại theo ID"""
    conn = get_db_connection()
    complaint = conn.execute('''
        SELECT c.*, e.name as employee_name, e.employee_code
        FROM complaint c
        JOIN employee e ON c.employee_id = e.id
        WHERE c.id = ?
    ''', (complaint_id,)).fetchone()
    conn.close()
    return dict(complaint) if complaint else None

def process_complaint(complaint_id, status, admin_id, admin_note):
    """Xử lý đơn khiếu nại"""
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    
    cursor.execute(
        'UPDATE complaint SET status = ?, processed_by = ?, processed_time = ?, admin_note = ? WHERE id = ?',
        (status, admin_id, now, admin_note, complaint_id)
    )
    
    conn.commit()
    conn.close()
    return True

# Các hàm thao tác với CheckLog
def get_employee_check_logs(employee_id, limit=10):
    """Lấy lịch sử chấm công của nhân viên"""
    conn = get_db_connection()
    logs = conn.execute('''
        SELECT c.*, a.check_in_time, a.check_out_time, a.work_duration
        FROM check_log c
        LEFT JOIN attendance a ON c.attendance_id = a.id
        WHERE c.employee_id = ?
        ORDER BY c.check_time DESC
        LIMIT ?
    ''', (employee_id, limit)).fetchall()
    conn.close()
    return [dict(log) for log in logs] 