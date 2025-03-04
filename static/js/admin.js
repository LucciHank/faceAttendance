document.addEventListener('DOMContentLoaded', function() {
    // Dashboard elements
    const activeEmployeesCount = document.getElementById('activeEmployeesCount');
    const totalEmployeesCount = document.getElementById('totalEmployeesCount');
    const todayCheckinsCount = document.getElementById('todayCheckinsCount');
    const pendingComplaintsCount = document.getElementById('pendingComplaintsCount');
    const refreshActiveDashboardBtn = document.getElementById('refreshActiveDashboardBtn');
    const activeDashboardTable = document.getElementById('activeDashboardTable');

    // Attendance tab elements
    const timeFilter = document.getElementById('timeFilter');
    const refreshAttendanceBtn = document.getElementById('refreshAttendanceBtn');
    const attendanceTable = document.getElementById('attendanceTable');

    // Employees tab elements
    const refreshEmployeesBtn = document.getElementById('refreshEmployeesBtn');
    const employeesTable = document.getElementById('employeesTable');

    // Complaints tab elements
    const refreshComplaintsBtn = document.getElementById('refreshComplaintsBtn');
    const complaintTable = document.getElementById('complaintTable');
    const approveBtn = document.getElementById('approveBtn');
    const rejectBtn = document.getElementById('rejectBtn');

    // Hàm tải tổng quan dashboard
    function loadDashboard() {
        // 1. Tải số liệu thống kê
        fetch('/admin/stats')
            .then(response => response.json())
            .then(data => {
                activeEmployeesCount.textContent = data.active_employees;
                totalEmployeesCount.textContent = data.total_employees;
                todayCheckinsCount.textContent = data.today_checkins;
                pendingComplaintsCount.textContent = data.pending_complaints;
            })
            .catch(error => {
                console.error('Lỗi khi tải thông tin tổng quan:', error);
            });

        // 2. Tải nhân viên đang làm việc
        fetch('/admin/active-employees')
            .then(response => response.json())
            .then(data => {
                activeDashboardTable.innerHTML = '';
                
                if (data.length === 0) {
                    activeDashboardTable.innerHTML = `
                        <tr>
                            <td colspan="3" class="text-center py-4">
                                <i class="fas fa-user-clock mb-2" style="font-size: 2rem; color: rgba(255,255,255,0.1);"></i>
                                <p class="mb-0">Hiện không có nhân viên nào đang làm việc</p>
                            </td>
                        </tr>
                    `;
                    return;
                }
                
                data.forEach(record => {
                    // Tính thời gian làm việc
                    let duration = 'Đang làm việc';
                    if (record.work_duration) {
                        const hours = Math.floor(record.work_duration / 3600);
                        const minutes = Math.floor((record.work_duration % 3600) / 60);
                        duration = `${hours}h ${minutes}m`;
                    }
                    
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>
                            <div class="d-flex align-items-center">
                                ${record.profile_image ? 
                                    `<img src="/${record.profile_image}" class="rounded-circle me-2" width="40" height="40">` : 
                                    `<div class="avatar-placeholder me-2"><i class="fas fa-user"></i></div>`
                                }
                                <div>
                                    <div class="fw-bold">${record.name}</div>
                                    <small class="text-muted">${record.employee_code}</small>
                                </div>
                            </div>
                        </td>
                        <td>${new Date(record.check_in_time).toLocaleTimeString()}</td>
                        <td>${duration}</td>
                    `;
                    activeDashboardTable.appendChild(row);
                });
            })
            .catch(error => {
                console.error('Lỗi khi tải nhân viên đang làm việc:', error);
                activeDashboardTable.innerHTML = `
                    <tr>
                        <td colspan="3" class="text-center py-4 text-danger">
                            <i class="fas fa-exclamation-triangle mb-2"></i>
                            <p class="mb-0">Lỗi khi tải dữ liệu</p>
                        </td>
                    </tr>
                `;
            });
    }

    // Hàm tải lịch sử chấm công
    function loadAttendanceHistory(days = 7) {
        fetch(`/admin/attendance-history?days=${days}`)
            .then(response => response.json())
            .then(data => {
                attendanceTable.innerHTML = '';
                
                if (data.length === 0) {
                    attendanceTable.innerHTML = `
                        <tr>
                            <td colspan="6" class="text-center py-4">
                                <i class="fas fa-history mb-2" style="font-size: 2rem; color: rgba(255,255,255,0.1);"></i>
                                <p class="mb-0">Không có dữ liệu chấm công trong khoảng thời gian này</p>
                            </td>
                        </tr>
                    `;
                    return;
                }
                
                data.forEach(record => {
                    let statusText = 'Đang làm việc';
                    let statusClass = 'status-pending';
                    
                    if (record.status === 'checked_out') {
                        statusText = 'Đã check-out';
                        statusClass = 'status-approved';
                    }
                    
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>
                            <div class="d-flex flex-column">
                                <span class="fw-bold">${record.employee_name}</span>
                                <small class="text-muted">${record.employee_code}</small>
                            </div>
                        </td>
                        <td>${new Date(record.check_in_time).toLocaleString()}</td>
                        <td>${record.check_out_time ? new Date(record.check_out_time).toLocaleString() : '-'}</td>
                        <td>${record.work_duration}</td>
                        <td><span class="complaint-status ${statusClass}">${statusText}</span></td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-outline-light view-attendance-btn" data-id="${record.id}">
                                <i class="fas fa-eye"></i>
                            </button>
                        </td>
                    `;
                    
                    attendanceTable.appendChild(row);
                });
            })
            .catch(error => {
                console.error('Lỗi khi tải lịch sử chấm công:', error);
                attendanceTable.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center py-4 text-danger">
                            <i class="fas fa-exclamation-triangle mb-2"></i>
                            <p class="mb-0">Lỗi khi tải dữ liệu</p>
                        </td>
                    </tr>
                `;
            });
    }

    // Hàm tải danh sách nhân viên
    function loadEmployees() {
        fetch('/admin/employees-list')
            .then(response => response.json())
            .then(data => {
                employeesTable.innerHTML = '';
                
                if (data.length === 0) {
                    employeesTable.innerHTML = `
                        <tr>
                            <td colspan="5" class="text-center py-4">
                                <i class="fas fa-users-slash mb-2" style="font-size: 2rem; color: rgba(255,255,255,0.1);"></i>
                                <p class="mb-0">Chưa có nhân viên nào</p>
                            </td>
                        </tr>
                    `;
                    return;
                }
                
                data.forEach(employee => {
                    const imgSrc = employee.profile_image ? 
                        `/${employee.profile_image}` : 
                        'https://via.placeholder.com/40?text=?';
                    
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${employee.employee_code}</td>
                        <td>
                            <div class="d-flex flex-column">
                                <span class="fw-bold">${employee.name}</span>
                            </div>
                        </td>
                        <td>
                            <img src="${imgSrc}" alt="${employee.name}" class="rounded-circle" width="40" height="40">
                        </td>
                        <td>${new Date(employee.created_at).toLocaleDateString()}</td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-outline-light view-employee-btn" data-id="${employee.id}">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-info edit-employee-btn" data-id="${employee.id}">
                                <i class="fas fa-edit"></i>
                            </button>
                        </td>
                    `;
                    
                    employeesTable.appendChild(row);
                });
            })
            .catch(error => {
                console.error('Lỗi khi tải danh sách nhân viên:', error);
                employeesTable.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-center py-4 text-danger">
                            <i class="fas fa-exclamation-triangle mb-2"></i>
                            <p class="mb-0">Lỗi khi tải dữ liệu</p>
                        </td>
                    </tr>
                `;
            });
    }

    // Hàm tải danh sách khiếu nại
    function loadComplaints() {
        fetch('/admin/complaints')
            .then(response => response.json())
            .then(data => {
                complaintTable.innerHTML = '';
                
                if (data.length === 0) {
                    complaintTable.innerHTML = `
                        <tr>
                            <td colspan="6" class="text-center py-4">
                                <i class="fas fa-clipboard mb-2" style="font-size: 2rem; color: rgba(255,255,255,0.1);"></i>
                                <p class="mb-0">Chưa có đơn khiếu nại nào</p>
                            </td>
                        </tr>
                    `;
                    return;
                }
                
                data.forEach(complaint => {
                    let statusText, statusClass;
                    switch (complaint.status) {
                        case 'pending':
                            statusText = 'Đang chờ';
                            statusClass = 'status-pending';
                            break;
                        case 'approved':
                            statusText = 'Đã duyệt';
                            statusClass = 'status-approved';
                            break;
                        case 'rejected':
                            statusText = 'Đã từ chối';
                            statusClass = 'status-rejected';
                            break;
                    }
                    
                    // Chuyển đổi mã lý do thành văn bản
                    const reasonText = getReasonText(complaint.reason);
                    
                    const row = document.createElement('tr');
                    row.className = `complaint-list-item ${complaint.status}`;
                    row.innerHTML = `
                        <td>#${complaint.id}</td>
                        <td>
                            <div class="d-flex flex-column">
                                <span class="fw-bold">${complaint.employee_name}</span>
                                <small class="text-muted">${complaint.employee_code}</small>
                            </div>
                        </td>
                        <td>${new Date(complaint.complaint_time).toLocaleString()}</td>
                        <td>${reasonText}</td>
                        <td><span class="complaint-status ${statusClass}">${statusText}</span></td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-outline-light view-complaint-btn" data-id="${complaint.id}">
                                <i class="fas fa-eye"></i>
                            </button>
                        </td>
                    `;
                    
                    complaintTable.appendChild(row);
                });
                
                // Gắn sự kiện cho nút xem chi tiết
                document.querySelectorAll('.view-complaint-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const complaintId = btn.getAttribute('data-id');
                        showComplaintDetails(complaintId);
                    });
                });
            })
            .catch(error => {
                console.error('Lỗi khi tải danh sách khiếu nại:', error);
                complaintTable.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center py-4 text-danger">
                            <i class="fas fa-exclamation-triangle mb-2"></i>
                            <p class="mb-0">Lỗi khi tải dữ liệu</p>
                        </td>
                    </tr>
                `;
            });
    }

    // Hàm hiển thị chi tiết đơn khiếu nại
    function showComplaintDetails(complaintId) {
        fetch(`/admin/complaint/${complaintId}`)
            .then(response => response.json())
            .then(data => {
                // Lưu ID đơn hiện tại
                document.getElementById('currentComplaintId').value = complaintId;
                
                // Cập nhật thông tin
                document.getElementById('complaintId').textContent = `#${data.id}`;
                document.getElementById('complaintEmployee').textContent = `${data.employee_name} (${data.employee_code})`;
                document.getElementById('complaintTime').textContent = new Date(data.complaint_time).toLocaleString();
                document.getElementById('complaintReason').textContent = getReasonText(data.reason);
                document.getElementById('complaintDetails').textContent = data.details || 'Không có chi tiết';
                
                if (data.requested_time) {
                    document.getElementById('complaintRequestedTime').textContent = new Date(data.requested_time).toLocaleString();
                } else {
                    document.getElementById('complaintRequestedTime').textContent = 'Không có';
                }
                
                let statusText;
                switch (data.status) {
                    case 'pending':
                        statusText = 'Đang chờ xử lý';
                        break;
                    case 'approved':
                        statusText = 'Đã duyệt';
                        break;
                    case 'rejected':
                        statusText = 'Đã từ chối';
                        break;
                }
                document.getElementById('complaintStatus').textContent = statusText;
                
                // Hiển thị ảnh
                if (data.photo) {
                    document.getElementById('complaintDetailPhoto').src = `/${data.photo}`;
                } else {
                    document.getElementById('complaintDetailPhoto').src = '/static/img/no-image.jpg';
                }
                
                // Hiện/ẩn các phần tùy theo trạng thái
                if (data.status === 'pending') {
                    document.getElementById('adminResponseSection').classList.remove('d-none');
                    document.getElementById('processedInfo').classList.add('d-none');
                } else {
                    document.getElementById('adminResponseSection').classList.add('d-none');
                    document.getElementById('processedInfo').classList.remove('d-none');
                    document.getElementById('processedBy').textContent = data.admin_name || 'Admin';
                    document.getElementById('processedTime').textContent = data.processed_time ? new Date(data.processed_time).toLocaleString() : 'N/A';
                    document.getElementById('processedNote').textContent = data.admin_note || 'Không có ghi chú';
                }
                
                // Hiển thị modal
                const complaintDetailModal = new bootstrap.Modal(document.getElementById('complaintDetailModal'));
                complaintDetailModal.show();
            })
            .catch(error => {
                console.error('Lỗi khi tải chi tiết đơn khiếu nại:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Lỗi',
                    text: 'Không thể tải thông tin đơn khiếu nại'
                });
            });
    }

    // Hàm xử lý đơn khiếu nại
    function processComplaint(complaintId, status) {
        const adminNote = document.getElementById('adminNote').value;
        
        fetch('/admin/process-complaint', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                complaint_id: complaintId,
                status: status,
                admin_note: adminNote
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Đóng modal
                const complaintDetailModal = bootstrap.Modal.getInstance(document.getElementById('complaintDetailModal'));
                complaintDetailModal.hide();
                
                // Hiển thị thông báo thành công
                Swal.fire({
                    icon: 'success',
                    title: 'Thành công',
                    text: `Đơn khiếu nại đã được ${status === 'approved' ? 'duyệt' : 'từ chối'}`
                });
                
                // Tải lại danh sách đơn khiếu nại
                loadComplaints();
                // Cập nhật lại dashboard
                loadDashboard();
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Lỗi',
                    text: data.error || 'Không thể xử lý đơn khiếu nại'
                });
            }
        })
        .catch(error => {
            console.error('Lỗi khi xử lý đơn khiếu nại:', error);
            Swal.fire({
                icon: 'error',
                title: 'Lỗi',
                text: 'Có lỗi xảy ra khi xử lý đơn khiếu nại'
            });
        });
    }

    // Hàm chuyển đổi mã lý do thành văn bản
    function getReasonText(reasonCode) {
        switch (reasonCode) {
            case 'system_error':
                return 'Máy chấm công bị lỗi';
            case 'blurry_image':
                return 'Ảnh bị mờ';
            case 'misidentification':
                return 'Nhận diện sai';
            case 'technical_issues':
                return 'Lỗi kỹ thuật';
            case 'other':
                return 'Lý do khác';
            default:
                return reasonCode;
        }
    }

    // Xử lý sự kiện đăng nhập admin
    document.getElementById('adminLoginSubmitBtn')?.addEventListener('click', function() {
        const username = document.getElementById('adminUsername').value;
        const password = document.getElementById('adminPassword').value;
        
        fetch('/admin/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = '/admin';
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Đăng nhập thất bại',
                    text: data.error || 'Tên đăng nhập hoặc mật khẩu không đúng'
                });
            }
        })
        .catch(error => {
            console.error('Lỗi khi đăng nhập:', error);
            Swal.fire({
                icon: 'error',
                title: 'Lỗi',
                text: 'Có lỗi xảy ra khi đăng nhập'
            });
        });
    });

    // Initial load
    if (document.getElementById('dashboard')) {
        loadDashboard();
    }
    
    if (document.getElementById('attendance')) {
        loadAttendanceHistory();
    }
    
    if (document.getElementById('employees')) {
        loadEmployees();
    }
    
    if (document.getElementById('complaints')) {
        loadComplaints();
    }
    
    // Các sự kiện
    if (refreshActiveDashboardBtn) {
        refreshActiveDashboardBtn.addEventListener('click', loadDashboard);
    }
    
    if (refreshAttendanceBtn) {
        refreshAttendanceBtn.addEventListener('click', function() {
            loadAttendanceHistory(timeFilter.value);
        });
    }
    
    if (timeFilter) {
        timeFilter.addEventListener('change', function() {
            loadAttendanceHistory(this.value);
        });
    }
    
    if (refreshEmployeesBtn) {
        refreshEmployeesBtn.addEventListener('click', loadEmployees);
    }
    
    if (refreshComplaintsBtn) {
        refreshComplaintsBtn.addEventListener('click', loadComplaints);
    }
    
    if (approveBtn) {
        approveBtn.addEventListener('click', function() {
            const complaintId = document.getElementById('currentComplaintId').value;
            processComplaint(complaintId, 'approved');
        });
    }
    
    if (rejectBtn) {
        rejectBtn.addEventListener('click', function() {
            const complaintId = document.getElementById('currentComplaintId').value;
            processComplaint(complaintId, 'rejected');
        });
    }
});

// Xử lý event cho tab navigation với Bootstrap
window.addEventListener('DOMContentLoaded', (event) => {
    document.querySelectorAll('.nav-link').forEach(navLink => {
        navLink.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(tab => tab.classList.remove('show', 'active'));
            
            this.classList.add('active');
            const targetId = this.getAttribute('data-bs-target');
            document.querySelector(targetId).classList.add('show', 'active');
        });
    });
}); 