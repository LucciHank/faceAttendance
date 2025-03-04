// Tạo file mới để xử lý modal
document.addEventListener('DOMContentLoaded', function() {
    console.log("Đang khởi tạo modal handler...");
    
    // Xử lý nút quản lý
    const adminLoginBtn = document.getElementById('adminLoginBtn');
    if (adminLoginBtn) {
        console.log("Đang cài đặt event cho nút quản lý");
        
        adminLoginBtn.addEventListener('click', function(e) {
            console.log("Đã click vào nút quản lý");
            
            try {
                const modalElement = document.getElementById('adminLoginModal');
                if (modalElement) {
                    const adminModal = new bootstrap.Modal(modalElement);
                    adminModal.show();
                    console.log("Đã mở modal quản lý");
                } else {
                    console.error("Không tìm thấy element adminLoginModal");
                }
            } catch (error) {
                console.error("Lỗi khi mở modal quản lý:", error);
                alert("Không thể mở form đăng nhập. Vui lòng tải lại trang.");
            }
        });
    }
    
    // Xử lý nút khiếu nại
    const complaintBtn = document.getElementById('complaintBtn');
    if (complaintBtn) {
        console.log("Đang cài đặt event cho nút khiếu nại");
        
        complaintBtn.addEventListener('click', function(e) {
            console.log("Đã click vào nút khiếu nại");
            
            try {
                // Cập nhật thời gian hiện tại
                const now = new Date();
                const complaintTime = document.getElementById('complaintTime');
                if (complaintTime) {
                    complaintTime.value = now.toLocaleString();
                }
                
                // Tự động chụp ảnh
                captureComplaintPhoto();
                
                // Mở modal khiếu nại
                const modalElement = document.getElementById('complaintModal');
                if (modalElement) {
                    const complaintModal = new bootstrap.Modal(modalElement);
                    complaintModal.show();
                    console.log("Đã mở modal khiếu nại");
                } else {
                    console.error("Không tìm thấy element complaintModal");
                }
            } catch (error) {
                console.error("Lỗi khi mở modal khiếu nại:", error);
                alert("Không thể mở form khiếu nại. Vui lòng tải lại trang.");
            }
        });
    }
    
    // Cập nhật hàm chụp ảnh cho form khiếu nại để không có bounding box
    window.captureComplaintPhoto = function() {
        console.log("Đang chụp ảnh nguyên bản cho khiếu nại...");
        
        // Lấy ảnh từ nguồn video mà không xử lý thêm
        fetch('/capture-raw-frame')
            .then(response => response.blob())
            .then(blob => {
                const url = URL.createObjectURL(blob);
                const complaintPhoto = document.getElementById('complaintPhoto');
                if (complaintPhoto) {
                    complaintPhoto.src = url;
                    complaintPhoto.dataset.capturedImage = url;
                }
                console.log("Đã chụp ảnh nguyên bản thành công");
            })
            .catch(e => {
                console.error("Lỗi khi chụp ảnh nguyên bản:", e);
                const complaintPhoto = document.getElementById('complaintPhoto');
                if (complaintPhoto) {
                    complaintPhoto.src = '/static/images/camera_placeholder.png';
                }
            });
    };
    
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