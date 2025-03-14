document.addEventListener('DOMContentLoaded', function() {
    // Khởi tạo modal
    employeeModal = new bootstrap.Modal(document.getElementById('employeeModal'));
    
    // Tải dữ liệu ban đầu
    loadEmployees();
    loadAttendanceHistory();
    loadComplaints();
    
    // Set ngày mặc định cho bộ lọc
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
    document.getElementById('startDate').value = lastMonth.toISOString().split('T')[0];
    document.getElementById('endDate').value = today.toISOString().split('T')[0];
});

// Hàm tải danh sách nhân viên
async function loadEmployees(search = '') {
    try {
        const response = await fetch(`/api/employees?search=${search}`);
        const data = await response.json();
        
        if (data.success) {
            const tbody = document.getElementById('employeesList');
            tbody.innerHTML = data.data.map(emp => `
                <tr>
                    <td>${emp.employee_id}</td>
                    <td>${emp.name}</td>
                    <td>${new Date(emp.created_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="editEmployee('${emp.employee_id}', '${emp.name}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteEmployee('${emp.employee_id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                        </td>
                    </tr>
            `).join('');
        }
    } catch (error) {
        console.error('Lỗi tải danh sách nhân viên:', error);
        showToast('Lỗi khi tải danh sách nhân viên', 'error');
    }
}

// Hàm tải lịch sử chấm công
async function loadAttendanceHistory(page = 1) {
    try {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        const response = await fetch(`/api/attendance/history?start_date=${startDate}&end_date=${endDate}&page=${page}`);
        const data = await response.json();
        
        if (data.success) {
            const tbody = document.getElementById('attendanceHistory');
            tbody.innerHTML = data.records.map(record => `
                <tr>
                    <td>${record.employee_id}</td>
                    <td>${record.name}</td>
                        <td>${new Date(record.check_in_time).toLocaleString()}</td>
                        <td>${record.check_out_time ? new Date(record.check_out_time).toLocaleString() : '-'}</td>
                    <td>${calculateDuration(record.check_in_time, record.check_out_time)}</td>
                    </tr>
            `).join('');
            
            updatePagination(data.current_page, data.pages);
        }
    } catch (error) {
        console.error('Lỗi tải lịch sử chấm công:', error);
        showToast('Lỗi khi tải lịch sử chấm công', 'error');
    }
}

// Hàm tính thời gian làm việc
function calculateDuration(checkIn, checkOut) {
    if (!checkOut) return '-';
    const duration = new Date(checkOut) - new Date(checkIn);
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
}

// Hàm cập nhật phân trang
function updatePagination(currentPage, totalPages) {
    const pagination = document.getElementById('pagination');
    let html = '<nav><ul class="pagination">';
    
    for (let i = 1; i <= totalPages; i++) {
        html += `
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" onclick="loadAttendanceHistory(${i})">${i}</a>
            </li>
        `;
    }
    
    html += '</ul></nav>';
    pagination.innerHTML = html;
}

// Các hàm quản lý nhân viên
function showAddEmployeeModal() {
    currentEmployeeId = null;
    document.getElementById('modalTitle').textContent = 'Thêm nhân viên';
    document.getElementById('employeeIdInput').value = '';
    document.getElementById('employeeNameInput').value = '';
    document.getElementById('employeeIdInput').disabled = false;
    employeeModal.show();
}

function editEmployee(employeeId, name) {
    currentEmployeeId = employeeId;
    document.getElementById('modalTitle').textContent = 'Sửa nhân viên';
    document.getElementById('employeeIdInput').value = employeeId;
    document.getElementById('employeeNameInput').value = name;
    document.getElementById('employeeIdInput').disabled = true;
    employeeModal.show();
}

async function saveEmployee() {
    const employeeId = document.getElementById('employeeIdInput').value;
    const name = document.getElementById('employeeNameInput').value;
    
    if (!employeeId || !name) {
        showToast('Vui lòng nhập đầy đủ thông tin', 'error');
        return;
    }
    
    try {
        const url = currentEmployeeId ? 
            `/api/employees/${currentEmployeeId}` : 
            '/api/employees';
            
        const method = currentEmployeeId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                employee_id: employeeId,
                name: name
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(data.message, 'success');
            employeeModal.hide();
            loadEmployees();
        } else {
            showToast(data.message, 'error');
        }
    } catch (error) {
        console.error('Lỗi lưu nhân viên:', error);
        showToast('Lỗi khi lưu thông tin nhân viên', 'error');
    }
}

async function deleteEmployee(employeeId) {
    try {
        const result = await Swal.fire({
            title: 'Xác nhận xóa?',
            text: "Bạn không thể hoàn tác sau khi xóa!",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Xóa',
            cancelButtonText: 'Hủy'
        });
        
        if (result.isConfirmed) {
            const response = await fetch(`/api/employees/${employeeId}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                showToast(data.message, 'success');
                loadEmployees();
            } else {
                showToast(data.message, 'error');
            }
        }
    } catch (error) {
        console.error('Lỗi xóa nhân viên:', error);
        showToast('Lỗi khi xóa nhân viên', 'error');
    }
}

// Hàm hiển thị thông báo
function showToast(title, icon = 'success') {
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        iconColor: icon === 'success' ? 'var(--success)' : 
                  icon === 'error' ? 'var(--danger)' : 
                  'var(--accent-primary)',
        customClass: {
            popup: 'animated-toast'
        }
    });

    Toast.fire({ icon, title });
}

// Thêm hàm tải danh sách khiếu nại
async function loadComplaints() {
    try {
        const response = await fetch('/api/complaints');
        const data = await response.json();
        
        if (data.success) {
            const tbody = document.getElementById('complaintsList');
            tbody.innerHTML = data.complaints.map(complaint => `
                <tr>
                    <td>${complaint.employee_id}</td>
                    <td>${getComplaintReason(complaint.reason)}</td>
                    <td>${new Date(complaint.created_at).toLocaleString()}</td>
                    <td>
                        <span class="badge ${getStatusBadgeClass(complaint.status)}">
                            ${getStatusText(complaint.status)}
                        </span>
                    </td>
                    <td>
                        <button class="btn btn-sm btn-info" onclick="viewComplaint(${complaint.id})">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-success" onclick="approveComplaint(${complaint.id})">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="rejectComplaint(${complaint.id})">
                            <i class="fas fa-times"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    } catch (error) {
        console.error('Lỗi tải danh sách khiếu nại:', error);
        showToast('Lỗi khi tải danh sách khiếu nại', 'error');
    }
}

// Thêm các hàm tiện ích
function getComplaintReason(reason) {
    const reasons = {
        'no_face': 'Không nhận diện được khuôn mặt',
        'wrong_face': 'Nhận diện sai người',
        'technical': 'Lỗi kỹ thuật',
        'other': 'Lý do khác'
    };
    return reasons[reason] || reason;
}

function getStatusBadgeClass(status) {
    const classes = {
        'pending': 'bg-warning',
        'approved': 'bg-success',
        'rejected': 'bg-danger'
    };
    return classes[status] || 'bg-secondary';
}

function getStatusText(status) {
    const texts = {
        'pending': 'Chờ xử lý',
        'approved': 'Đã duyệt',
        'rejected': 'Đã từ chối'
    };
    return texts[status] || status;
}

// Thêm các hàm xử lý khiếu nại
async function viewComplaint(id) {
    try {
        const response = await fetch(`/api/complaints/${id}`);
        const data = await response.json();
        
        if (data.success) {
            // Hiển thị modal xem chi tiết khiếu nại
            Swal.fire({
                title: 'Chi tiết khiếu nại',
                html: `
                    <div class="text-center mb-3">
                        <img src="${data.complaint.image}" class="img-fluid rounded">
                    </div>
                    <div class="mb-3">
                        <strong>Mã nhân viên:</strong> ${data.complaint.employee_id}
                    </div>
                    <div class="mb-3">
                        <strong>Lý do:</strong> ${getComplaintReason(data.complaint.reason)}
                    </div>
                    <div class="mb-3">
                        <strong>Ghi chú:</strong> ${data.complaint.note || 'Không có'}
                    </div>
                `,
                showConfirmButton: false
            });
        }
    } catch (error) {
        console.error('Lỗi xem chi tiết khiếu nại:', error);
        showToast('Lỗi khi xem chi tiết khiếu nại', 'error');
    }
}

async function approveComplaint(id) {
    try {
        const response = await fetch(`/api/complaints/${id}/approve`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            showToast('Đã duyệt khiếu nại', 'success');
            loadComplaints();
        } else {
            showToast(data.message, 'error');
        }
    } catch (error) {
        console.error('Lỗi duyệt khiếu nại:', error);
        showToast('Lỗi khi duyệt khiếu nại', 'error');
    }
}

async function rejectComplaint(id) {
    try {
        const response = await fetch(`/api/complaints/${id}/reject`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            showToast('Đã từ chối khiếu nại', 'success');
            loadComplaints();
        } else {
            showToast(data.message, 'error');
        }
    } catch (error) {
        console.error('Lỗi từ chối khiếu nại:', error);
        showToast('Lỗi khi từ chối khiếu nại', 'error');
    }
}

async function exportReport() {
    try {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        const response = await fetch(`/api/attendance/export?start_date=${startDate}&end_date=${endDate}`);
        const data = await response.json();
        
        if (data.success) {
            // Chuyển đổi dữ liệu thành CSV
            const csv = convertToCSV(data.data);
            
            // Tạo tên file với timestamp
            const timestamp = new Date().toISOString().slice(0,10);
            const filename = `attendance_report_${timestamp}.csv`;
            
            // Tải file
            downloadCSV(csv, filename);
        } else {
            showToast('Lỗi khi xuất báo cáo', 'error');
        }
    } catch (error) {
        console.error('Lỗi xuất báo cáo:', error);
        showToast('Lỗi khi xuất báo cáo', 'error');
    }
}

function convertToCSV(data) {
    const headers = ['Mã NV', 'Tên', 'Số ngày làm việc', 'Check-in đầu tiên', 'Check-out cuối cùng', 'Số giờ trung bình'];
    const rows = data.map(item => [
        item.employee_id,
        item.name,
        item.total_days,
        new Date(item.first_check_in).toLocaleString(),
        item.last_check_out ? new Date(item.last_check_out).toLocaleString() : '-',
        item.avg_hours.toFixed(2)
    ]);
    
    return [headers, ...rows]
        .map(row => row.join(','))
        .join('\n');
}

function downloadCSV(csv, filename) {
    // Thêm BOM cho UTF-8
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
} 