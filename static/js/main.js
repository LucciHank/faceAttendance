document.addEventListener('DOMContentLoaded', function() {
    const videoStream = document.getElementById("videoStream");
    const openCamBtn = document.getElementById("openCam");
    const closeCamBtn = document.getElementById("closeCam");
    const loadingIndicator = document.getElementById("loadingIndicator");
    const statusDot = document.querySelector(".status-dot");
    const statusBadge = document.querySelector("#status .badge");
    const detectionStatus = document.getElementById("detectionStatus");
    const confidenceLevel = document.getElementById("confidenceLevel");
    const currentTime = document.getElementById("currentTime");
    const checkInBtn = document.getElementById('checkInBtn');
    const checkOutBtn = document.getElementById('checkOutBtn');
    const confirmBtn = document.getElementById('confirmBtn');
    const employeeId = document.getElementById('employeeId');
    const workDuration = document.getElementById('workDuration');
    const confidenceProgress = document.querySelector('.confidence-progress');
    
    let isRetrying = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    let currentMode = null;
    let checkInTime = null;
    let noFaceTimeout = null;
    let autoConfirmTimeout = null;
    let countdownInterval = null;
    let cameraInitialized = false;
    let lastAudioElement = null;
    let lastFaceDetected = false;
    let pollInterval;
    let isInCooldown = false;
    let cooldownTimer = null;
    let attendanceHistory = [];
    let employeeModal;
    let currentEmployeeId = null;
    let complaintModal;
    let faceDetectionTimeout;
    
    // Khởi tạo Chart.js
    const ctx = document.getElementById('attendanceChart').getContext('2d');
    const attendanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Số nhân viên check in',
                data: [],
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1
            }, {
                label: 'Số nhân viên check out',
                data: [],
                borderColor: 'rgb(255, 99, 132)',
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Thống kê chấm công theo ngày'
                }
            }
        }
    });

    // Khởi tạo modal
    employeeModal = new bootstrap.Modal(document.getElementById('employeeModal'));
    loadEmployees();
    loadMonthOptions();

    // Khởi tạo modal khiếu nại
    complaintModal = new bootstrap.Modal(document.getElementById('complaintModal'));
    
    // Khởi động camera ngay khi trang load
    function initCamera() {
        if (videoStream) {
            // Tạo canvas trước khi load video
            canvas = document.createElement('canvas');
            ctx = canvas.getContext('2d');
            
            // Set kích thước canvas
            canvas.width = 640;
            canvas.height = 480;
            
            // Load video stream
            videoStream.src = "/video_feed";
            
            // Bắt đầu polling face detection ngay lập tức
            startFaceDetectionPolling();
        }
    }

    // Cập nhật thời gian
    function updateDateTime() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const currentTime = document.getElementById('currentTime');
        if (currentTime) {
            currentTime.textContent = timeString;
        }
    }

    // Cập nhật thời gian mỗi giây
    setInterval(updateDateTime, 1000);

    // Cập nhật ngay khi trang load
    document.addEventListener('DOMContentLoaded', function() {
        updateDateTime();
        // ... existing code ...
    });

    // Khởi động camera
    initCamera();

    // Xử lý button khiếu nại
    const complaintBtn = document.getElementById('complaintBtn');
    if (complaintBtn) {
        complaintBtn.addEventListener('click', function() {
            const video = document.getElementById('videoStream');
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            
            document.getElementById('complaintImage').src = canvas.toDataURL('image/jpeg');
            document.getElementById('complaintTime').value = new Date().toLocaleString();
            
            const complaintModal = new bootstrap.Modal(document.getElementById('complaintModal'));
            complaintModal.show();
        });
    }

    function updateStatus(isActive) {
        if (isActive) {
            statusDot.classList.add("active");
            statusBadge.className = "badge bg-success";
            statusBadge.textContent = "Camera đang hoạt động";
            openCamBtn.disabled = true;
            closeCamBtn.disabled = false;
            detectionStatus.textContent = "Đang quét...";
        } else {
            statusDot.classList.remove("active");
            statusBadge.className = "badge bg-secondary";
            statusBadge.textContent = "Camera đang tắt";
            openCamBtn.disabled = false;
            closeCamBtn.disabled = true;
            detectionStatus.textContent = "Chưa phát hiện";
            confidenceLevel.textContent = "--.--%";
        }
    }

    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger alert-dismissible fade show mt-3';
        errorDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.querySelector('.video-container').insertAdjacentElement('afterend', errorDiv);
        
        setTimeout(() => {
            errorDiv.remove();
        }, 5000);
    }

    function retryConnection() {
        if (retryCount < MAX_RETRIES && !isRetrying) {
            isRetrying = true;
            retryCount++;
            console.log(`Đang thử kết nối lại... (${retryCount}/${MAX_RETRIES})`);
            
            setTimeout(() => {
                videoStream.src = "/video_feed";
                isRetrying = false;
            }, 2000);
        } else if (retryCount >= MAX_RETRIES) {
            console.log("Đã vượt quá số lần thử kết nối lại");
            updateStatus(false);
            showError("Không thể kết nối với camera. Vui lòng thử lại sau.");
        }
    }

    function checkCameraStatus() {
        fetch('/status')
            .then(response => response.json())
            .then(data => {
                updateStatus(data.active);
            })
            .catch(error => {
                console.error('Lỗi khi kiểm tra trạng thái:', error);
            });
    }

    // Text to Speech function
    function playTTS(text) {
        return new Promise((resolve, reject) => {
            fetch('/tts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: text })
            })
            .then(response => response.blob())
            .then(blob => {
                const audioUrl = URL.createObjectURL(blob);
                const audio = new Audio(audioUrl);
                
                audio.onended = () => {
                    URL.revokeObjectURL(audioUrl); // Giải phóng memory
                    resolve();
                };
                
                audio.onerror = (error) => {
                    URL.revokeObjectURL(audioUrl);
                    reject(error);
                };
                
                audio.play();
            })
            .catch(error => {
                console.error('Lỗi TTS:', error);
                reject(error);
            });
        });
    }

    function startCountdown(seconds, onComplete) {
        let timeLeft = seconds;
        clearInterval(countdownInterval);
        
        countdownInterval = setInterval(() => {
            if (timeLeft > 0) {
                confirmBtn.textContent = `Xác nhận (${timeLeft}s)`;
                playTTS(`${timeLeft}`);
                timeLeft--;
            } else {
                clearInterval(countdownInterval);
                confirmBtn.textContent = 'Xác nhận';
                onComplete();
            }
        }, 1000);
    }

    function startCooldown(seconds) {
        isInCooldown = true;
        clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(() => {
            isInCooldown = false;
        }, seconds * 1000);
    }

    // Thêm hàm hiển thị thông báo toast
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
            },
            didOpen: (toast) => {
                toast.addEventListener('mouseenter', Swal.stopTimer)
                toast.addEventListener('mouseleave', Swal.resumeTimer)
            }
        });

        Toast.fire({ icon, title });
    }

    // Thêm hàm hiển thị dialog thành công
    function showSuccessDialog(title, details) {
        return Swal.fire({
            html: `
                <div class="success-content">
                    <div class="success-animation">
                        <div class="checkmark-circle">
                            <svg class="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                                <circle class="checkmark__circle" cx="26" cy="26" r="25" fill="none"/>
                                <path class="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                            </svg>
                        </div>
                    </div>
                    <h2 class="success-title">${title}</h2>
                    <div class="success-info">
                        ${details}
                    </div>
                </div>
            `,
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            confirmButtonColor: 'var(--success)',
            confirmButtonText: 'Đóng',
            showClass: {
                popup: 'animate__animated animate__fadeInDown'
            },
            hideClass: {
                popup: 'animate__animated animate__fadeOutUp'
            },
            customClass: {
                container: 'success-dialog-container',
                popup: 'success-dialog',
                htmlContainer: 'success-dialog-content',
                confirmButton: 'success-dialog-button'
            }
        });
    }

    function updateAttendanceHistory() {
        const tbody = document.getElementById('attendanceHistory');
        if (!tbody) return;
        
        tbody.innerHTML = attendanceHistory.map(record => `
            <tr>
                <td>${record.employeeId}</td>
                <td>${record.checkIn || '-'}</td>
                <td>${record.checkOut || '-'}</td>
                <td>
                    <span class="status-badge ${record.checkOut ? 'status-checkout' : 'status-checkin'}">
                        ${record.checkOut ? 'Đã check out' : 'Đã check in'}
                    </span>
                </td>
            </tr>
        `).join('');
    }

    function handleConfirm() {
        stopCamera();
        
        if (currentMode === 'checkin') {
            if (checkInTime) {
                playTTS("Bạn đã chếch in rồi!");
                showToast('Bạn đã check in rồi!', 'warning');
                return;
            }
            
            const now = new Date();
            checkInTime = now;
            employeeId.textContent = 'A12345';
            
            // Thêm vào lịch sử
            attendanceHistory.unshift({
                employeeId: 'A12345',
                checkIn: now.toLocaleTimeString(),
                checkOut: null
            });
            updateAttendanceHistory();
            
            playTTS("Chếch in thành công");
            showSuccessDialog(
                'Check In Thành Công',
                `
                <div class="info-row">
                    <i class="fas fa-id-card"></i>
                    <span>Mã nhân viên: A12345</span>
                </div>
                <div class="info-row">
                    <i class="fas fa-clock"></i>
                    <span>Thời gian: ${now.toLocaleTimeString()}</span>
                </div>
                `
            );
            
            startCooldown(5);
        } else if (currentMode === 'checkout') {
            if (!checkInTime) {
                playTTS("Bạn chưa chếch in!");
                showToast('Bạn chưa check in!', 'error');
                return;
            }
            
            const now = new Date();
            const duration = Math.floor((now - checkInTime) / 1000);
            const hours = Math.floor(duration / 3600);
            const minutes = Math.floor((duration % 3600) / 60);
            const timeText = `${hours} giờ ${minutes} phút`;
            workDuration.textContent = timeText;
            
            // Cập nhật lịch sử
            const record = attendanceHistory.find(r => r.employeeId === 'A12345' && !r.checkOut);
            if (record) {
                record.checkOut = now.toLocaleTimeString();
                updateAttendanceHistory();
            }
            
            playTTS(`Thời gian làm việc của bạn là ${timeText}`);
            showSuccessDialog(
                'Check Out Thành Công',
                `
                <div class="info-row">
                    <i class="fas fa-id-card"></i>
                    <span>Mã nhân viên: A12345</span>
                </div>
                <div class="info-row">
                    <i class="fas fa-hourglass-end"></i>
                    <span>Thời gian làm việc: ${timeText}</span>
                </div>
                <div class="info-row">
                    <i class="fas fa-clock"></i>
                    <span>Thời gian check out: ${now.toLocaleTimeString()}</span>
                </div>
                `
            );
            
            checkInTime = null;
            startCooldown(5);
        }
    }

    function startCamera() {
        if (currentMode === 'checkout' && !checkInTime) {
            playTTS("Bạn chưa chếch in! Vui lòng chếch in trước");
            return;
        }
        
        // Dừng mọi polling và interval đang chạy
        stopCamera();
        
        // Khởi động camera với mode
        videoStream.src = `/video_feed?mode=${currentMode}`;
        
        // Hiển thị hiệu ứng scan và ẩn placeholder
        const faceOverlay = document.querySelector('.face-overlay');
        const scanLine = document.querySelector('.scan-line');
        const placeholder = document.querySelector('.video-placeholder');
        
        if (faceOverlay) faceOverlay.style.display = 'block';
        if (scanLine) scanLine.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';

        // Reset các trạng thái
        confirmBtn.style.display = 'none';
        confirmBtn.disabled = true;
        lastFaceDetected = false;
        
        // Đánh dấu camera đã khởi tạo
        cameraInitialized = true;
        
        // Bắt đầu polling ngay lập tức
        pollFaceDetection();
        pollInterval = setInterval(pollFaceDetection, 500);
    }

    function stopCamera() {
        videoStream.src = '';
        confirmBtn.style.display = 'none';
        
        const faceOverlay = document.querySelector('.face-overlay');
        const scanLine = document.querySelector('.scan-line');
        const placeholder = document.querySelector('.video-placeholder');
        if (faceOverlay) faceOverlay.style.display = 'none';
        if (scanLine) scanLine.style.display = 'none';
        if (placeholder) placeholder.style.display = 'block';
        
        // Clear tất cả các timers
        clearInterval(countdownInterval);
        clearInterval(pollInterval);
        clearTimeout(noFaceTimeout);
        clearTimeout(cooldownTimer);
        
        // Reset các trạng thái
        cameraInitialized = false;
        lastFaceDetected = false;
        isInCooldown = false;
        pollInterval = null;
    }

    function resetUI() {
        if (currentMode === 'checkin') {
            employeeId.textContent = 'Chưa xác định';
            workDuration.textContent = 'Chưa check out';
        }
    }

    function resetModeButtons() {
        checkInBtn.classList.remove('active');
        checkOutBtn.classList.remove('active');
        currentMode = null;
    }

    // Event Listeners
    checkInBtn.addEventListener('click', function() {
        currentMode = 'checkin';
        checkInBtn.classList.add('active');
        checkOutBtn.classList.remove('active');
        startCamera();
    });

    checkOutBtn.addEventListener('click', function() {
        currentMode = 'checkout';
        checkOutBtn.classList.add('active');
        checkInBtn.classList.remove('active');
        startCamera();
    });

    videoStream.addEventListener('error', function() {
        loadingIndicator.classList.add("d-none");
        retryConnection();
    });

    // Kiểm tra trạng thái camera mỗi 5 giây
    setInterval(checkCameraStatus, 5000);
    
    // Kiểm tra trạng thái ban đầu
    checkCameraStatus();

    // Reset camera after 10 seconds without face
    function startNoFaceTimer() {
        clearTimeout(noFaceTimeout);
        noFaceTimeout = setTimeout(() => {
            stopCamera();
            playTTS("Không phát hiện khuôn mặt, camera sẽ tắt");
            detectionStatus.textContent = "Không phát hiện khuôn mặt";
        }, 10000);
    }

    // Cập nhật trạng thái button xác nhận khi phát hiện khuôn mặt
    function updateConfirmButton(faceDetected) {
        const confirmBtn = document.getElementById('confirmBtn');
        if (faceDetected) {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '1';
            confirmBtn.style.cursor = 'pointer';
        } else {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
            confirmBtn.style.cursor = 'not-allowed';
        }
    }

    // Hàm polling face detection
    function pollFaceDetection() {
        if (!cameraInitialized || isInCooldown) return;
        
        fetch('/status')
            .then(response => response.json())
            .then(data => {
                // Cập nhật thanh confidence
                const confidence = parseFloat(data.confidence) * 100;
                const confidenceBar = document.querySelector('.confidence-progress');
                if (confidenceBar) {
                    confidenceBar.style.width = `${confidence}%`;
                }
                
                // Cập nhật trạng thái button xác nhận
                const confirmBtn = document.getElementById('confirmBtn');
                if (confirmBtn) {
                    if (data.face_detected && confidence > 80) {
                        confirmBtn.style.display = 'block';
                        confirmBtn.disabled = false;
                        confirmBtn.style.opacity = '1';
                        confirmBtn.style.cursor = 'pointer';
                        
                        // Khi phát hiện khuôn mặt với độ tin cậy cao
                        if (!lastFaceDetected) {
                            console.log("Phát hiện khuôn mặt mới với độ tin cậy cao!");
                            // Bắt đầu đếm ngược 3 giây
                        startCountdown(3, () => {
                                if (!confirmBtn.disabled) {
                                handleConfirm();
                            }
                        });
                    }
                    lastFaceDetected = true;
                } else {
                    confirmBtn.style.display = 'none';
                    confirmBtn.disabled = true;
                        confirmBtn.style.opacity = '0.5';
                        confirmBtn.style.cursor = 'not-allowed';
                    clearInterval(countdownInterval);
                    lastFaceDetected = false;
                    }
                }
            })
            .catch(error => {
                console.error('Lỗi khi kiểm tra face detection:', error);
            });
    }

    // Hàm bắt đầu polling face detection
    function startFaceDetectionPolling() {
        // Dừng polling cũ nếu có
        if (pollInterval) {
            clearInterval(pollInterval);
        }
        
        // Bắt đầu polling mới
        pollFaceDetection();
        pollInterval = setInterval(pollFaceDetection, 500);
    }

    function handleSuccess(mode) {
        const successMessage = mode === 'checkin' ? 'Chấm công vào thành công!' : 'Chấm công ra thành công!';
        const audioText = mode === 'checkin' ? 'Chấm công vào thành công!' : 'Chấm công ra thành công!';

        // Hiển thị thông báo thành công
        Swal.fire({
            icon: 'success',
            title: successMessage,
            html: `
                <div class="success-content">
                    <div class="success-info">
                        <div class="info-row">
                            <i class="fas fa-user"></i>
                            <span>Nhân viên: Nguyễn Văn A</span>
                        </div>
                        <div class="info-row">
                            <i class="fas fa-clock"></i>
                            <span>Thời gian: ${getCurrentTime()}</span>
                        </div>
                    </div>
                </div>
            `,
            showConfirmButton: false,
            timer: 3000,
            customClass: {
                popup: 'success-dialog'
            }
        });

        // Phát âm thanh thông báo
        playTTS(audioText).then(() => {
            // Đợi 5 giây sau khi phát âm thanh xong
            setTimeout(() => {
                // Bắt đầu đếm ngược 3 giây
                let countdown = 3;
                const countdownInterval = setInterval(() => {
                    if (countdown > 0) {
                        Swal.fire({
                            title: `Hệ thống sẽ reset sau ${countdown} giây`,
                            timer: 1000,
                            showConfirmButton: false,
                            customClass: {
                                popup: 'animated-toast'
                            }
                        });
                        countdown--;
                    } else {
                        clearInterval(countdownInterval);
                        resetSystem();
                    }
                }, 1000);
            }, 5000); // Đợi 5 giây
        });
    }

    function resetSystem() {
        // Reset lại trạng thái hệ thống
        isProcessing = false;
        document.getElementById('checkinBtn').disabled = false;
        document.getElementById('checkoutBtn').disabled = false;
        // Reset các trạng thái khác nếu cần
    }

    // Thêm hàm reset lịch sử vào cuối ngày
    function resetAttendanceHistory() {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
            attendanceHistory = [];
            updateAttendanceHistory();
        }
    }

    // Thêm interval để kiểm tra reset lịch sử
    setInterval(resetAttendanceHistory, 60000);

    // Thêm các hàm xử lý API
    async function checkIn(employeeId) {
        try {
            const response = await fetch('/api/attendance/check-in', {
            method: 'POST',
            headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ employee_id: employeeId })
            });
            
            const data = await response.json();
            if (data.success) {
                // Cập nhật UI và lịch sử
                updateAttendanceHistory();
                return true;
            } else {
                showToast(data.message, 'error');
                return false;
            }
        } catch (error) {
            console.error('Lỗi check in:', error);
            showToast('Lỗi khi check in', 'error');
            return false;
        }
    }

    async function checkOut(employeeId) {
        try {
            const response = await fetch('/api/attendance/check-out', {
            method: 'POST',
            headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ employee_id: employeeId })
            });
            
            const data = await response.json();
            if (data.success) {
                // Cập nhật UI và lịch sử
                updateAttendanceHistory();
                return true;
                                } else {
                showToast(data.message, 'error');
                return false;
            }
        } catch (error) {
            console.error('Lỗi check out:', error);
            showToast('Lỗi khi check out', 'error');
            return false;
        }
    }

    // Cập nhật hàm updateAttendanceHistory để sử dụng API
    async function updateAttendanceHistory(page = 1) {
        try {
            const date = new Date().toISOString().split('T')[0];
            const response = await fetch(`/api/attendance/history?date=${date}&page=${page}`);
            const data = await response.json();
            
            const tbody = document.getElementById('attendanceHistory');
            if (!tbody) return;
            
            tbody.innerHTML = data.records.map(record => `
                <tr>
                    <td>${record.employee_id}</td>
                    <td>${new Date(record.check_in_time).toLocaleTimeString()}</td>
                    <td>${record.check_out_time ? new Date(record.check_out_time).toLocaleTimeString() : '-'}</td>
                    <td>
                        <span class="status-badge ${record.check_out_time ? 'status-checkout' : 'status-checkin'}">
                            ${record.check_out_time ? 'Đã check out' : 'Đã check in'}
                        </span>
                        </td>
                </tr>
            `).join('');
            
            // Cập nhật phân trang
            updatePagination(data.current_page, data.pages);
        } catch (error) {
            console.error('Lỗi cập nhật lịch sử:', error);
            showToast('Lỗi khi cập nhật lịch sử', 'error');
        }
    }

    // Thêm hàm xuất báo cáo
    async function exportReport() {
        try {
            const today = new Date();
            const startDate = new Date(today.setDate(today.getDate() - 30)).toISOString().split('T')[0];
            const endDate = new Date().toISOString().split('T')[0];
            
            const response = await fetch(`/api/attendance/export?start_date=${startDate}&end_date=${endDate}`);
            const data = await response.json();
            
            if (data.success) {
                // Tạo file Excel hoặc CSV từ data
                const csv = convertToCSV(data.data);
                downloadCSV(csv, `attendance_report_${startDate}_${endDate}.csv`);
                } else {
                showToast(data.message, 'error');
            }
        } catch (error) {
            console.error('Lỗi xuất báo cáo:', error);
            showToast('Lỗi khi xuất báo cáo', 'error');
        }
    }

    // Thêm các hàm tiện ích
    function convertToCSV(data) {
        const headers = ['Mã NV', 'Tên', 'Số ngày', 'Check in đầu tiên', 'Check out cuối', 'Giờ TB'];
        const rows = data.map(record => [
            record.employee_id,
            record.name,
            record.total_days,
            record.first_check_in,
            record.last_check_out,
            record.avg_hours
        ]);
        
        return [headers, ...rows]
            .map(row => row.join(','))
            .join('\n');
    }

    function downloadCSV(csv, filename) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
    }

    // Hàm xử lý khiếu nại
    function handleComplaint() {
        const videoStream = document.getElementById('videoStream');
        const complaintImage = document.getElementById('complaintImage');
        const complaintTime = document.getElementById('complaintTime');
        
        // Tạo canvas tạm thời để chụp ảnh
        const canvas = document.createElement('canvas');
        canvas.width = videoStream.videoWidth;
        canvas.height = videoStream.videoHeight;
        const ctx = canvas.getContext('2d');
        
        // Vẽ ảnh từ video stream
        ctx.drawImage(videoStream, 0, 0, canvas.width, canvas.height);
        
        // Chuyển canvas thành ảnh
        const imageData = canvas.toDataURL('image/jpeg', 0.8);
        
        // Hiển thị ảnh trong modal
        complaintImage.src = imageData;
        complaintImage.style.display = 'block';
        complaintImage.classList.add('complaint-image');
        
        // Cập nhật thời gian khiếu nại
        complaintTime.value = new Date().toLocaleString('vi-VN');
        
        // Hiển thị thông báo
        showToast('Đã chụp ảnh khiếu nại', 'success');
    }

    function retakePhoto() {
        const complaintImage = document.getElementById('complaintImage');
        const complaintTime = document.getElementById('complaintTime');
        
        complaintImage.src = '';
        complaintImage.style.display = 'none';
        complaintTime.value = '';
        
        showToast('Đã xóa ảnh', 'info');
    }

    async function submitComplaint() {
        const employeeId = document.getElementById('complaintEmployeeId').value;
        const reason = document.getElementById('complaintReason').value;
        const note = document.getElementById('complaintNote').value;
        const complaintImage = document.getElementById('complaintImage');
        
        // Kiểm tra dữ liệu
        if (!employeeId || !reason) {
            showToast('Vui lòng điền đầy đủ thông tin', 'error');
            return;
        }
        
        if (complaintImage.style.display === 'none') {
            showToast('Vui lòng chụp ảnh khiếu nại', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/complaints', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    employee_id: employeeId,
                    reason: reason,
                    note: note,
                    image: complaintImage.src
                })
            });
            
            const data = await response.json();
            if (data.success) {
                showToast(data.message, 'success');
                // Đóng modal
                const modal = bootstrap.Modal.getInstance(document.getElementById('complaintModal'));
                modal.hide();
                // Reset form
                document.getElementById('complaintForm').reset();
                complaintImage.src = '';
                complaintImage.style.display = 'none';
            } else {
                showToast(data.message, 'error');
            }
        } catch (error) {
            console.error('Lỗi gửi khiếu nại:', error);
            showToast('Có lỗi xảy ra khi gửi khiếu nại', 'error');
        }
    }

    // Hàm chụp ảnh cho đăng ký nhân viên
    function capturePhoto() {
        const video = document.getElementById('videoStream');
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = canvas.toDataURL('image/jpeg', 0.8);
            
            // Tìm vị trí trống trong danh sách ảnh
            const imageSlots = document.querySelectorAll('.image-slot');
            for (let slot of imageSlots) {
                if (!slot.querySelector('img')) {
                    const img = document.createElement('img');
                    img.src = imageData;
                    img.className = 'captured-image';
                    slot.innerHTML = '';
                    slot.appendChild(img);
                    break;
                }
            }
            } else {
            showToast('Vui lòng đợi camera khởi động', 'warning');
        }
    }

    // Hàm xóa ảnh đã chụp
    function removePhoto(element) {
        element.parentElement.innerHTML = '';
    }

    // Hàm hiển thị thông báo thành công
    function showSuccessMessage(message) {
                    Swal.fire({
                        icon: 'success',
            title: message,
            timer: 2000,
            showConfirmButton: false
        });
    }

    // Hàm hiển thị thông báo lỗi
    function showErrorMessage(message) {
                Swal.fire({
                    icon: 'error',
            title: message
        });
    }

    // Hàm tải danh sách nhân viên
    async function loadEmployees(search = '') {
        try {
            const response = await fetch(`/api/employees?search=${search}`);
            const data = await response.json();
            
            if (data.success) {
                const tbody = document.getElementById('employeesList');
                if (tbody) {
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
            }
        } catch (error) {
            console.error('Lỗi tải danh sách nhân viên:', error);
            showToast('Lỗi khi tải danh sách nhân viên', 'error');
        }
    }

    // Hàm tải dữ liệu biểu đồ
    async function loadChartData(startDate, endDate) {
        try {
            const response = await fetch(`/api/attendance/stats?start_date=${startDate}&end_date=${endDate}`);
            const data = await response.json();
            
            if (data.success) {
                attendanceChart.data.labels = data.data.map(item => item.date);
                attendanceChart.data.datasets[0].data = data.data.map(item => item.total_employees);
                attendanceChart.data.datasets[1].data = data.data.map(item => item.checked_out);
                attendanceChart.update();
            }
        } catch (error) {
            console.error('Lỗi tải dữ liệu biểu đồ:', error);
            showToast('Lỗi khi tải dữ liệu biểu đồ', 'error');
        }
    }

    // Hàm hiển thị modal thêm nhân viên
    function showAddEmployeeModal() {
        currentEmployeeId = null;
        document.getElementById('modalTitle').textContent = 'Thêm nhân viên';
        document.getElementById('employeeIdInput').value = '';
        document.getElementById('employeeNameInput').value = '';
        document.getElementById('employeeIdInput').disabled = false;
        employeeModal.show();
    }

    // Hàm hiển thị modal sửa nhân viên
    function editEmployee(employeeId, name) {
        currentEmployeeId = employeeId;
        document.getElementById('modalTitle').textContent = 'Sửa nhân viên';
        document.getElementById('employeeIdInput').value = employeeId;
        document.getElementById('employeeNameInput').value = name;
        document.getElementById('employeeIdInput').disabled = true;
        employeeModal.show();
    }

    // Hàm lưu nhân viên
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

    // Hàm xóa nhân viên
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

    // Hàm áp dụng bộ lọc
    function applyFilters() {
        const search = document.getElementById('searchInput').value;
        const date = document.getElementById('dateFilter').value;
        const month = document.getElementById('monthFilter').value;
        
        // Cập nhật danh sách nhân viên
        loadEmployees(search);
        
        // Cập nhật lịch sử chấm công
        updateAttendanceHistory(1, date, month);
        
        // Cập nhật biểu đồ
        if (date) {
            loadChartData(date, date);
        } else if (month) {
            const [year, month] = month.split('-');
            const startDate = `${year}-${month}-01`;
            const endDate = new Date(year, month, 0).toISOString().split('T')[0];
            loadChartData(startDate, endDate);
        }
    }

    // Hàm tải options cho bộ lọc tháng
    function loadMonthOptions() {
        const monthSelect = document.getElementById('monthSelect');
        if (!monthSelect) return;
        
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth();
        const currentYear = currentDate.getFullYear();
        
        for (let i = 0; i < 12; i++) {
            const date = new Date(currentYear, i, 1);
            const option = document.createElement('option');
            option.value = `${currentYear}-${String(i + 1).padStart(2, '0')}`;
            option.textContent = date.toLocaleString('vi-VN', { month: 'long', year: 'numeric' });
            option.selected = i === currentMonth;
            monthSelect.appendChild(option);
        }
    }

    async function updateTodayAttendance() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const response = await fetch(`/api/attendance/history?date=${today}`);
            const data = await response.json();
            
            if (data.success) {
                const tbody = document.getElementById('todayAttendance');
                if (tbody) {
                    tbody.innerHTML = data.records.map(record => `
                        <tr>
                            <td>${record.employee_id}</td>
                            <td>${record.name}</td>
                            <td>${new Date(record.check_in_time).toLocaleTimeString('vi-VN')}</td>
                            <td>${record.check_out_time ? new Date(record.check_out_time).toLocaleTimeString('vi-VN') : '-'}</td>
                            <td>
                                <span class="badge ${record.check_out_time ? 'bg-success' : 'bg-warning'}">
                                    ${record.check_out_time ? 'Đã check out' : 'Đang làm việc'}
                                </span>
                            </td>
                        </tr>
                    `).join('');
                }
            }
        } catch (error) {
            console.error('Lỗi cập nhật chấm công:', error);
        }
    }

    // Cập nhật mỗi phút
    setInterval(updateTodayAttendance, 60000);
    // Gọi ngay lập tức khi trang load
    updateTodayAttendance();
});
