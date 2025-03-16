from flask import Blueprint, request, jsonify
from ai import train
from models import db, Employee, Attendance, get_vn_time
from sqlalchemy import func

api_bp = Blueprint('api', __name__)

@api_bp.route('/employee', methods=['POST'])
def add_employee():
    if 'images' not in request.files:
        print('Không đủ')
        return jsonify({'error': 'No file or name provided'}), 400
    files = request.files.getlist('images')
    name = request.form.get('name')
    new_employee = Employee(name=name)
    db.session.add(new_employee)
    db.session.commit()
    employee_id = new_employee.id
    train(files, employee_id)
    return jsonify({
        'employee_id': employee_id,
        'name': new_employee.name,
        'message': 'Employee added successfully'
    })

@api_bp.route('/checkin', methods=['POST'])
def checkin_employee():
    employee_id = request.form.get('employee_id')
    if not employee_id:
        return jsonify({'error': 'No id provided'}), 400
    employee_id = int(employee_id)
    current_time = get_vn_time()
    today = current_time.date()
    attendance = Attendance.query.filter(
        Attendance.employee_id == employee_id,
        func.DATE(Attendance.check_in_time) == today
    ).order_by(Attendance.check_in_time.desc()).first()
    if not attendance:
        # Nếu chưa có bản ghi, tạo check-in mới
        new_attendance = Attendance(employee_id=employee_id)
        db.session.add(new_attendance)
        message = "Check-in thành công"
    else:
        # Nếu đã có, cập nhật thời gian check-out
        attendance.check_out_time = current_time
        message = "Check-out thành công"
    db.session.commit()
    return jsonify({'success': True, 'message': message}), 201
    