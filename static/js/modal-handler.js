// Thêm vào đầu file
if (typeof $ === 'undefined') {
    const $ = document.querySelector.bind(document);
}

// Tạo file mới để xử lý modal
document.addEventListener('DOMContentLoaded', function() {
    console.log("Đang khởi tạo modal handler...");
    
    // Xử lý nút mở modal quản lý
    const adminLoginBtn = document.getElementById('adminLoginBtn');
    if (adminLoginBtn) {
        console.log("Đang cài đặt event cho nút quản lý");
        adminLoginBtn.addEventListener('click', function() {
            console.log("Đã click vào nút quản lý");
            try {
                const modal = new bootstrap.Modal(document.getElementById('adminLoginModal'));
                modal.show();
                console.log("Đã mở modal quản lý");
                
                // Xử lý form đăng nhập
                const adminLoginForm = document.getElementById('adminLoginForm');
                if (adminLoginForm) {
                    adminLoginForm.addEventListener('submit', function(e) {
                        e.preventDefault();
                        
                        const username = document.getElementById('adminUsername').value;
                        const password = document.getElementById('adminPassword').value;
                        
                        // Kiểm tra dữ liệu
                        if (!username || !password) {
                            Swal.fire({
                                icon: 'warning',
                                title: 'Thiếu thông tin',
                                text: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu',
                                confirmButtonColor: '#00ff9d'
                            });
                            return;
                        }
                        
                        // Hiển thị loading
                        Swal.fire({
                            title: 'Đang đăng nhập...',
                            allowOutsideClick: false,
                            didOpen: () => {
                                Swal.showLoading();
                            }
                        });
                        
                        // Gửi request đăng nhập
                        fetch('/admin/login', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                username: username,
                                password: password
                            })
                        })
                        .then(response => response.json())
                        .then(data => {
                            console.log("Login response:", data);
                            
                            if (data.success) {
                                // Đóng modal trước khi chuyển hướng
                                const modalElement = document.getElementById('adminLoginModal');
                                const modal = bootstrap.Modal.getInstance(modalElement);
                                if (modal) {
                                    modal.hide();
                                }
                                
                                // Xóa backdrop và cleanup
                                const backdrop = document.querySelector('.modal-backdrop');
                                if (backdrop) backdrop.remove();
                                document.body.classList.remove('modal-open');
                                
                                Swal.fire({
                                    icon: 'success',
                                    title: 'Đăng nhập thành công!',
                                    text: 'Đang chuyển hướng...',
                                    timer: 1500,
                                    showConfirmButton: false
                                }).then(() => {
                                    window.location.href = '/admin/dashboard';
                                });
                            } else {
                                $('#loginError').text(data.error).show();
                            }
                        })
                        .catch(error => {
                            console.error('Login error:', error);
                            $('#loginError').text('Có lỗi xảy ra khi đăng nhập').show();
                        });
                    });
                }
            } catch (error) {
                console.error("Lỗi khi mở modal quản lý:", error);
            }
        });
    }
    
    // Xử lý nút khiếu nại
    const complaintBtn = document.getElementById('complaintBtn');
    if (complaintBtn) {
        console.log("Đang cài đặt event cho nút khiếu nại");
        
        complaintBtn.addEventListener('click', function(e) {
            console.log("Đã click vào nút khiếu nại");
            e.preventDefault();
            
            // Cập nhật thời gian hiện tại
            const now = new Date();
            const complaintTime = document.getElementById('complaintTime');
            if (complaintTime) {
                complaintTime.value = now.toLocaleString();
            }
            
            // Mở modal
            const modalElement = document.getElementById('complaintModal');
            if (modalElement) {
                const complaintModal = new bootstrap.Modal(modalElement);
                complaintModal.show();
                console.log("Đã mở modal khiếu nại");
                
                // Gọi hàm chụp ảnh sau khi modal đã mở
                setTimeout(captureComplaintPhoto, 500);
            } else {
                console.error("Không tìm thấy element complaintModal");
                alert("Không thể mở form khiếu nại. Vui lòng tải lại trang.");
            }
        });
    }
    
    // Thêm event listener cho nút chụp lại
    document.getElementById('retakePhotoBtn')?.addEventListener('click', function(e) {
        e.preventDefault();
        captureComplaintPhoto();
    });
    
    // Xử lý hiển thị tên nhân viên khi nhập mã
    const employeeCode = document.getElementById('employeeCode');
    if (employeeCode) {
        employeeCode.addEventListener('input', function() {
            if (this.value.length === 6) {
                // Gọi API để lấy thông tin nhân viên
                fetch(`/get-employee-by-code/${this.value}`)
                    .then(response => response.json())
                    .then(data => {
                        const employeeName = document.getElementById('employeeName');
                        if (employeeName) {
                            if (data.success) {
                                employeeName.textContent = data.employee.name;
                                employeeName.style.color = 'var(--success)';
                            } else {
                                employeeName.textContent = 'Không tìm thấy nhân viên';
                                employeeName.style.color = 'var(--danger)';
                            }
                        }
                    })
                    .catch(error => {
                        console.error("Lỗi khi lấy thông tin nhân viên:", error);
                    });
            }
        });
    }

    // Xử lý hiển thị/ẩn phần lý do khác
    const complaintReason = document.getElementById('complaintReason');
    const otherReasonContainer = document.getElementById('otherReasonContainer');

    if (complaintReason && otherReasonContainer) {
        complaintReason.addEventListener('change', function() {
            if (this.value === 'other') {
                otherReasonContainer.classList.remove('d-none');
            } else {
                otherReasonContainer.classList.add('d-none');
            }
        });
    }

    // Xử lý submit form khiếu nại
    const submitComplaintBtn = document.getElementById('submitComplaintBtn');
    if (submitComplaintBtn) {
        submitComplaintBtn.addEventListener('click', function() {
            const form = document.getElementById('complaintForm');
            if (form.checkValidity()) {
                // Tạo FormData từ form
                const formData = new FormData(form);
                
                // Thêm ảnh vào formData
                const complaintPhoto = document.getElementById('complaintPhoto');
                if (complaintPhoto && complaintPhoto.src) {
                    // Chuyển ảnh thành blob và thêm vào formData
                    fetch(complaintPhoto.src)
                        .then(res => res.blob())
                        .then(blob => {
                            formData.append('photo', blob, 'complaint.jpg');
                            
                            // Gửi dữ liệu lên server
                            submitComplaint(formData);
                        });
                } else {
                    submitComplaint(formData);
                }
            } else {
                form.reportValidity();
            }
        });
    }

    function submitComplaint(formData) {
        // Hiển thị loading
        Swal.fire({
            title: 'Đang gửi khiếu nại...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
        
        // Gửi dữ liệu lên server
        fetch('/submit-complaint', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                Swal.fire({
                    icon: 'success',
                    title: 'Đã gửi khiếu nại!',
                    text: 'Đơn khiếu nại của bạn đã được ghi nhận và sẽ được xử lý trong thời gian sớm nhất.',
                    confirmButtonColor: 'var(--accent-primary)'
                });
                
                // Đóng modal
                const complaintModal = bootstrap.Modal.getInstance(document.getElementById('complaintModal'));
                if (complaintModal) {
                    complaintModal.hide();
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Lỗi',
                    text: data.error || 'Không thể gửi khiếu nại. Vui lòng thử lại sau.',
                    confirmButtonColor: 'var(--accent-primary)'
                });
            }
        })
        .catch(error => {
            console.error('Lỗi:', error);
            Swal.fire({
                icon: 'error',
                title: 'Lỗi kết nối',
                text: 'Không thể kết nối với server. Vui lòng thử lại sau.',
                confirmButtonColor: 'var(--accent-primary)'
            });
        });
    }

    // Xử lý chụp ảnh khiếu nại
    const captureBtn = document.getElementById('captureComplaintBtn');
    if (captureBtn) {
        captureBtn.addEventListener('click', captureComplaintPhoto);
    }
});

// Thêm vào cuối file để sửa lỗi backdrop modal
document.addEventListener('hidden.bs.modal', function (event) {
    setTimeout(() => {
        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(backdrop => {
            backdrop.remove();
        });
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }, 300);
});

// Thêm event handler cho nút đóng modal
document.querySelectorAll('[data-bs-dismiss="modal"]').forEach(button => {
    button.addEventListener('click', function() {
        setTimeout(() => {
            const backdrops = document.querySelectorAll('.modal-backdrop');
            backdrops.forEach(backdrop => {
                backdrop.remove();
            });
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }, 300);
    });
});

// Hàm kiểm tra mã nhân viên và điền tên
function checkEmployeeCode() {
    const employeeCodeInput = document.getElementById('employeeCode');
    const employeeNameField = document.getElementById('employeeName');
    
    if (!employeeCodeInput || !employeeNameField) return;
    
    const employeeCode = employeeCodeInput.value.trim();
    if (!employeeCode) return;
    
    fetch(`/api/employee-info?code=${employeeCode}`)
        .then(response => response.json())
        .then(data => {
            if (data.success && data.employee) {
                employeeNameField.value = data.employee.name;
            } else {
                employeeNameField.value = '';
                Swal.fire({
                    icon: 'warning',
                    title: 'Mã nhân viên không tồn tại',
                    text: 'Vui lòng kiểm tra lại mã nhân viên'
                });
            }
        })
        .catch(error => {
            console.error("Lỗi khi kiểm tra mã nhân viên:", error);
        });
}

// Sửa lại hàm captureComplaintPhoto
window.captureComplaintPhoto = function() {
    console.log("Đang chụp ảnh nguyên bản cho khiếu nại...");
    
    // Hiển thị trạng thái đang tải
    const imagePreview = document.getElementById('imagePreview');
    if (imagePreview) {
        imagePreview.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"></div><div class="mt-2">Đang chụp ảnh...</div></div>';
        imagePreview.style.display = 'block';
    }
    
    // Lấy ảnh từ server
    fetch('/capture-complaint-image')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                if (imagePreview) {
                    imagePreview.innerHTML = '<img id="capturedImage" class="img-fluid rounded" alt="Ảnh khiếu nại"/>';
                    const capturedImage = document.getElementById('capturedImage');
                    if (capturedImage) capturedImage.src = data.image;
                }
                
                // Lưu dữ liệu ảnh vào input ẩn
                const complaintImage = document.getElementById('complaintImage');
                if (complaintImage) complaintImage.value = data.image;
                
                console.log("Đã chụp ảnh khiếu nại thành công");
            } else {
                console.error("Lỗi khi chụp ảnh từ server:", data.error);
                if (imagePreview) {
                    imagePreview.innerHTML = '<div class="alert alert-danger">Không thể chụp ảnh. Lỗi: ' + data.error + '</div>';
                }
            }
        })
        .catch(error => {
            console.error("Lỗi kết nối khi chụp ảnh:", error);
            if (imagePreview) {
                imagePreview.innerHTML = '<div class="alert alert-danger">Lỗi kết nối khi chụp ảnh</div>';
            }
        });
}; 