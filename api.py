from flask import Blueprint, request, jsonify
from ai import train
from models import db, Employee

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

