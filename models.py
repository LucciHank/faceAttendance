from datetime import datetime
import pytz
import os
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
db_path = os.path.join(BASE_DIR, "company.db")

class Config:
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{db_path}"
    SQLALCHEMY_TRACK_MODIFICATIONS = False

# Múi giờ Việt Nam
VN_TZ = pytz.timezone('Asia/Ho_Chi_Minh')

def get_vn_time():
    return datetime.now(VN_TZ)

class BaseModel(db.Model):
    __abstract__ = True
    created_at = db.Column(db.DateTime, default=get_vn_time)

class Employee(BaseModel):
    __tablename__ = 'employees'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String, nullable=False)
    attendances = db.relationship('Attendance', backref='employee', lazy=True)

class Attendance(BaseModel):
    __tablename__ = 'attendance'

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey('employees.id'), nullable=False)  # sửa thành Integer
    check_in_time = db.Column(db.DateTime, nullable=False)
    check_out_time = db.Column(db.DateTime, nullable=True)  # Chỉnh lại nếu cần
    status = db.Column(db.String, default='on_time')

class Embedding(BaseModel):
    __tablename__ = 'embeddings'

    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.String, nullable=False)  # Không có ForeignKey
    embedding = db.Column(db.LargeBinary, nullable=False)