document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM đã tải xong, khởi tạo các chức năng...");
    
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
    const department = document.getElementById('department');
    const employeeName = document.getElementById('employeeName');
    const recognitionStatus = document.getElementById('recognitionStatus');
    const activeEmployeesList = document.getElementById('activeEmployeesList');
    const refreshActiveBtn = document.getElementById('refreshActiveBtn');
    const complaintBtn = document.getElementById('complaintBtn');
    
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
    let detectedEmployee = null;
    let isProcessing = false;
    let complaintImageData = null;

    // Thêm biến mới cho tính năm đếm ngược
    const countdownContainer = document.getElementById('countdownContainer');
    const countdownTimer = document.getElementById('countdownTimer');
    let countdownValue = 3;
    let faceDetectionTimer = null;
    let isCountingDown = false;
    
    function updateDateTime() {
        const now = new Date();
        currentTime.textContent = now.toLocaleTimeString();
    }

    setInterval(updateDateTime, 1000);
    updateDateTime();

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
            confidenceProgress.style.width = "0%";
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
        
        // Đặt nút xác nhận không có đếm ngược
        confirmBtn.textContent = 'Xác nhận';
        
        countdownInterval = setInterval(() => {
            if (timeLeft > 0) {
                // Không hiển thị đếm ngược trên nút
                // confirmBtn.textContent = `Xác nhận (${timeLeft}s)`;
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

    function handleConfirm() {
        stopCamera();
        
        if (currentMode === 'checkin') {
            if (checkInTime) {
                playTTS("Bạn đã chếch in rồi!");
                showToast('Bạn đã check in rồi!', 'warning');
                return;
            }
            checkInTime = new Date();
            employeeId.textContent = 'A12345';
            playTTS("Chếch in thành công");
            
            // Hiển thị thông báo check in thành công
            showSuccessDialog(
                'Check In Thành Công',
                `
                <div class="info-row">
                    <i class="fas fa-id-card"></i>
                    <span>Mã nhân viên: A12345</span>
                </div>
                <div class="info-row">
                    <i class="fas fa-clock"></i>
                    <span>Thời gian: ${new Date().toLocaleTimeString()}</span>
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
            
            const duration = Math.floor((new Date() - checkInTime) / 1000);
            const hours = Math.floor(duration / 3600);
            const minutes = Math.floor((duration % 3600) / 60);
            const timeText = `${hours} giờ ${minutes} phút`;
            
            // Hiển thị thông báo check out thành công
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
                    <span>Thời gian check out: ${new Date().toLocaleTimeString()}</span>
                </div>
                `
            );
            
            // Reset các giá trị sau khi check out
            checkInTime = null;
            employeeId.textContent = 'Chưa xác định';
            workDuration.textContent = 'Chưa check in';
            
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
        
        // Khởi động camera
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
        
        // Chỉ tạo một interval duy nhất
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
    if (openCamBtn) openCamBtn.addEventListener('click', startCamera);
    if (closeCamBtn) closeCamBtn.addEventListener('click', stopCamera);

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

    function pollFaceDetection() {
        if (!cameraInitialized || isInCooldown || isProcessing) return;
        
        fetch('/status')
            .then(response => response.json())
            .then(data => {
                // Cập nhật thanh confidence
                const confidence = parseFloat(data.confidence) * 100;
                const confidenceBar = document.querySelector('.confidence-progress');
                if (confidenceBar) {
                    confidenceBar.style.width = `${confidence}%`;
                }
                
                if (data.face_detected && !isInCooldown) {
                    // Khi phát hiện khuôn mặt
                    if (!lastFaceDetected) {
                        console.log("Phát hiện khuôn mặt mới!");
                        // Hiện button xác nhận và bắt đầu đếm ngược
                        confirmBtn.style.display = 'block';
                        confirmBtn.disabled = false;
                        
                        // Phát âm thanh và bắt đầu đếm ngược
                        startCountdown(3, () => {
                            if (confirmBtn.style.display !== 'none') {
                                handleConfirm();
                            }
                        });
                    }
                    lastFaceDetected = true;
                } else {
                    // Khi không phát hiện khuôn mặt
                    confirmBtn.style.display = 'none';
                    confirmBtn.disabled = true;
                    clearInterval(countdownInterval);
                    lastFaceDetected = false;
                }
            })
            .catch(error => {
                console.error('Lỗi khi kiểm tra face detection:', error);
            });
    }

    confirmBtn.addEventListener('click', handleConfirm);

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

    // Hàm tải và hiển thị danh sách nhân viên đang làm việc
    function loadActiveEmployees() {
        fetch('/today-attendance')
            .then(response => response.json())
            .then(data => {
                activeEmployeesList.innerHTML = '';
                
                if (data.length === 0) {
                    activeEmployeesList.innerHTML = `
                        <tr>
                            <td colspan="3" class="text-center py-4">
                                <i class="fas fa-clock mb-2" style="font-size: 2rem; color: rgba(255,255,255,0.1);"></i>
                                <p class="mb-0">Chưa có lịch sử chấm công hôm nay</p>
                            </td>
                        </tr>
                    `;
                    return;
                }
                
                data.forEach(record => {
                    // Format thời gian
                    const checkInTime = record.check_in_time ? new Date(record.check_in_time) : null;
                    const checkOutTime = record.check_out_time ? new Date(record.check_out_time) : null;
                    
                    const formattedCheckIn = checkInTime ? 
                        `${checkInTime.getHours().toString().padStart(2, '0')}:${checkInTime.getMinutes().toString().padStart(2, '0')}` : 
                        '- -';
                    
                    const formattedCheckOut = checkOutTime ? 
                        `${checkOutTime.getHours().toString().padStart(2, '0')}:${checkOutTime.getMinutes().toString().padStart(2, '0')}` : 
                        '- -';
                    
                    // Tạo hàng mới
                    const row = document.createElement('tr');
                    
                    // Highlight hàng nếu là nhân viên vừa chấm công
                    if (detectedEmployee && record.employee_id === detectedEmployee.id) {
                        row.classList.add('table-active', 'highlighted-row');
                    }
                    
                    row.innerHTML = `
                        <td>
                            <div class="d-flex align-items-center">
                                ${record.profile_image ? 
                                    `<img src="/${record.profile_image}" class="rounded-circle me-2" width="32" height="32">` : 
                                    `<div class="avatar-placeholder me-2" style="width: 32px; height: 32px;"><i class="fas fa-user"></i></div>`
                                }
                                <div>
                                    <div class="fw-bold">${record.name}</div>
                                    <small class="text-muted">${record.employee_code}</small>
                                </div>
                            </div>
                        </td>
                        <td>${formattedCheckIn}</td>
                        <td>${formattedCheckOut}</td>
                    `;
                    
                    activeEmployeesList.appendChild(row);
                });
            })
            .catch(error => {
                console.error('Lỗi khi tải danh sách chấm công:', error);
            });
    }

    // Hàm xử lý check-in
    function performCheckIn(employeeId) {
        if (!employeeId) {
            showToast('Không thể nhận diện nhân viên', 'error');
            return Promise.reject(new Error('Không thể nhận diện nhân viên'));
        }
        
        return fetch('/check-in', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                employee_id: employeeId,
                // Có thể thêm frame data (base64) nếu cần lưu ảnh
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                return Promise.reject(new Error(data.error));
            }
            return data;
        });
    }

    // Hàm xử lý check-out
    function performCheckOut(employeeId) {
        if (!employeeId) {
            showToast('Không thể nhận diện nhân viên', 'error');
            return Promise.reject(new Error('Không thể nhận diện nhân viên'));
        }
        
        return fetch('/check-out', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                employee_id: employeeId,
                // Có thể thêm frame data (base64) nếu cần lưu ảnh
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                return Promise.reject(new Error(data.error));
            }
            return data;
        });
    }

    // Xử lý khi xác nhận đã nhận diện khuôn mặt
    function handleConfirm() {
        if (isProcessing || !detectedEmployee) {
            return;
        }
        
        isProcessing = true;
        stopCamera();
        
        if (currentMode === 'checkin') {
            performCheckIn(detectedEmployee.id)
                .then(data => {
                    // Hiển thị thông báo check-in thành công
                    showSuccessDialog(
                        'Check In Thành Công',
                        `
                        <div class="info-row">
                            <i class="fas fa-user"></i>
                            <span>Nhân viên: ${detectedEmployee.name}</span>
                        </div>
                        <div class="info-row">
                            <i class="fas fa-id-card"></i>
                            <span>Mã nhân viên: ${detectedEmployee.employee_code}</span>
                        </div>
                        <div class="info-row">
                            <i class="fas fa-clock"></i>
                            <span>Thời gian: ${data.employee.check_in_time}</span>
                        </div>
                        `
                    );
                    
                    // Cập nhật giao diện
                    employeeId.textContent = detectedEmployee.employee_code;
                    department.textContent = detectedEmployee.department || 'N/A';
                    workDuration.textContent = 'Mới bắt đầu';
                    
                    // Phát thông báo audio
                    playTTS(`Chấm công vào thành công cho ${detectedEmployee.name}`).then(() => {
                        // Đợi 5 giây sau khi phát âm thanh xong
                        setTimeout(() => {
                            // Bắt đầu đếm ngược 3 giây để reset
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
                                    loadActiveEmployees(); // Làm mới danh sách nhân viên
                                }
                            }, 1000);
                        }, 5000);
                    });
                })
                .catch(error => {
                    console.error('Lỗi khi check-in:', error);
                    showToast(error.message || 'Lỗi khi check-in', 'error');
                    isProcessing = false;
                });
        } else if (currentMode === 'checkout') {
            performCheckOut(detectedEmployee.id)
                .then(data => {
                    // Hiển thị thông báo check-out thành công
                    showSuccessDialog(
                        'Check Out Thành Công',
                        `
                        <div class="info-row">
                            <i class="fas fa-user"></i>
                            <span>Nhân viên: ${detectedEmployee.name}</span>
                        </div>
                        <div class="info-row">
                            <i class="fas fa-id-card"></i>
                            <span>Mã nhân viên: ${detectedEmployee.employee_code}</span>
                        </div>
                        <div class="info-row">
                            <i class="fas fa-hourglass-end"></i>
                            <span>Thời gian làm việc: ${data.employee.work_duration_text}</span>
                        </div>
                        <div class="info-row">
                            <i class="fas fa-clock"></i>
                            <span>Thời gian check out: ${data.employee.check_out_time}</span>
                        </div>
                        `
                    );
                    
                    // Cập nhật giao diện
                    employeeId.textContent = detectedEmployee.employee_code;
                    department.textContent = detectedEmployee.department || 'N/A';
                    workDuration.textContent = data.employee.work_duration_text;
                    
                    // Phát thông báo audio
                    playTTS(`Chấm công ra thành công cho ${detectedEmployee.name}. Thời gian làm việc là ${data.employee.work_duration_text}`).then(() => {
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
                                    loadActiveEmployees(); // Làm mới danh sách nhân viên
                                }
                            }, 1000);
                        }, 5000);
                    });
                })
                .catch(error => {
                    console.error('Lỗi khi check-out:', error);
                    showToast(error.message || 'Lỗi khi check-out', 'error');
                    isProcessing = false;
                });
        }
    }

    function startCamera() {
        // Dừng mọi polling và interval đang chạy
        stopCamera();
        
        // Reset thông tin nhân viên
        detectedEmployee = null;
        employeeName.textContent = '';
        recognitionStatus.textContent = 'Đang quét khuôn mặt...';
        
        // Khởi động camera
        videoStream.src = `/video_feed`;
        
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
        
        // Đánh dấu camera đã khởi tạo
        cameraInitialized = true;
        
        // Chỉ tạo một interval duy nhất
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
        isInCooldown = false;
        pollInterval = null;
    }

    function resetSystem() {
        // Reset lại trạng thái hệ thống
        isProcessing = false;
        detectedEmployee = null;
        
        // Reset mode buttons
        checkInBtn.classList.remove('active');
        checkOutBtn.classList.remove('active');
        currentMode = null;
        
        // Reset UI
        employeeId.textContent = 'Chưa xác định';
        department.textContent = 'Chưa xác định';
        workDuration.textContent = 'Chưa check in';
        employeeName.textContent = '';
        recognitionStatus.textContent = 'Đang quét khuôn mặt...';
        
        // Tắt camera
        stopCamera();
    }

    function pollFaceDetection() {
        if (!cameraInitialized || isInCooldown || isProcessing) return;
        
        fetch('/status')
            .then(response => response.json())
            .then(data => {
                // Cập nhật thanh confidence
                const confidence = parseFloat(data.confidence) * 100;
                confidenceProgress.style.width = `${confidence}%`;
                confidenceLevel.textContent = confidence.toFixed(2) + '%';
                
                // Cập nhật thông tin nhân viên được phát hiện
                if (data.employee && data.face_detected) {
                    detectedEmployee = data.employee;
                    employeeName.textContent = detectedEmployee.name;
                    recognitionStatus.textContent = 'Đã nhận diện';
                    
                    // Hiển thị nút xác nhận
                    confirmBtn.style.display = 'block';
                    confirmBtn.disabled = false;
                    
                    // Bắt đầu đếm ngược tự động xác nhận
                    startCountdown(3, () => {
                        if (confirmBtn.style.display !== 'none' && !confirmBtn.disabled) {
                            handleConfirm();
                        }
                    });
                } else {
                    detectedEmployee = null;
                    employeeName.textContent = '';
                    
                    if (data.face_detected) {
                        recognitionStatus.textContent = 'Không nhận diện được khuôn mặt';
                    } else {
                        recognitionStatus.textContent = 'Đang quét khuôn mặt...';
                    }
                    
                    confirmBtn.style.display = 'none';
                    confirmBtn.disabled = true;
                    clearInterval(countdownInterval);
                }
            })
            .catch(error => {
                console.error('Lỗi khi kiểm tra face detection:', error);
            });
    }

    // Event Listeners
    if (openCamBtn) openCamBtn.addEventListener('click', startCamera);
    if (closeCamBtn) closeCamBtn.addEventListener('click', stopCamera);

    checkInBtn.addEventListener('click', function() {
        if (isProcessing) return;
        
        currentMode = 'checkin';
        checkInBtn.classList.add('active');
        checkOutBtn.classList.remove('active');
        startCamera();
    });

    checkOutBtn.addEventListener('click', function() {
        if (isProcessing) return;
        
        currentMode = 'checkout';
        checkOutBtn.classList.add('active');
        checkInBtn.classList.remove('active');
        startCamera();
    });

    confirmBtn.addEventListener('click', handleConfirm);
    
    refreshActiveBtn.addEventListener('click', function() {
        loadActiveEmployees();
        showToast('Đã làm mới danh sách nhân viên', 'info');
    });

    videoStream.addEventListener('error', function() {
        console.error('Lỗi kết nối video');
        showError('Không thể kết nối với camera. Vui lòng làm mới trang.');
    });

    // Tải danh sách nhân viên đang làm việc khi trang tải xong
    loadActiveEmployees();
    
    // Tự động làm mới danh sách mỗi 30 giây
    setInterval(loadActiveEmployees, 30000);

    // Thêm event listener cho nút khiếu nại
    document.getElementById('complaintBtn').addEventListener('click', function() {
        if (isProcessing) return;
        
        currentMode = 'complaint';
        complaintBtn.classList.add('active');
        checkinBtn.classList.remove('active');
        checkoutBtn.classList.remove('active');
        
        // Bật camera nếu chưa bật
        if (!cameraInitialized) {
            startCamera();
        }
        
        // Chụp ảnh hiện tại
        captureImageForComplaint();
        
        // Hiển thị modal khiếu nại
        const complaintModal = new bootstrap.Modal(document.getElementById('complaintModal'));
        complaintModal.show();
        
        // Cập nhật thời gian hiện tại
        const now = new Date();
        document.getElementById('complaintTime').value = now.toLocaleString();
        
        // Điền thông tin nhân viên nếu đã phát hiện
        if (detectedEmployee) {
            document.getElementById('employeeCode').value = detectedEmployee.employee_code;
        }
    });

    // Chụp ảnh cho form khiếu nại
    function captureImageForComplaint() {
        fetch('/capture_frame', {
            method: 'GET'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                complaintImageData = data.image;
                document.getElementById('complaintPhoto').src = 'data:image/jpeg;base64,' + complaintImageData;
            } else {
                showToast('Không thể chụp ảnh. Vui lòng thử lại.', 'error');
            }
        })
        .catch(error => {
            console.error('Lỗi khi chụp ảnh:', error);
            showToast('Lỗi khi chụp ảnh', 'error');
        });
    }

    // Chụp lại ảnh
    document.getElementById('retakePhotoBtn').addEventListener('click', function() {
        captureImageForComplaint();
    });

    // Gửi đơn khiếu nại
    document.getElementById('submitComplaintBtn').addEventListener('click', function() {
        const form = document.getElementById('complaintForm');
        
        // Kiểm tra dữ liệu nhập
        const employeeCode = document.getElementById('employeeCode').value;
        const reason = document.getElementById('complaintReason').value;
        
        if (!employeeCode || !reason || !complaintImageData) {
            showToast('Vui lòng điền đầy đủ thông tin và chụp ảnh', 'error');
            return;
        }
        
        // Tạo FormData
        const formData = new FormData(form);
        formData.append('image', complaintImageData);
        formData.append('complaint_time', document.getElementById('complaintTime').value);
        
        // Gửi dữ liệu
        fetch('/submit-complaint', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Đóng modal
                bootstrap.Modal.getInstance(document.getElementById('complaintModal')).hide();
                
                // Hiển thị thông báo thành công
                Swal.fire({
                    icon: 'success',
                    title: 'Gửi đơn thành công!',
                    text: 'Đơn khiếu nại của bạn đã được ghi nhận và sẽ được xử lý sớm.',
                    confirmButtonColor: 'var(--accent-primary)'
                });
                
                // Thông báo bằng giọng nói
                playTTS('Đơn khiếu nại của bạn đã được gửi thành công. Hệ thống sẽ xử lý trong thời gian sớm nhất.');
                
                // Reset form
                form.reset();
                complaintImageData = null;
                
                // Reset chế độ
                resetSystem();
            } else {
                showToast(data.error || 'Có lỗi xảy ra khi gửi đơn', 'error');
            }
        })
        .catch(error => {
            console.error('Lỗi khi gửi đơn khiếu nại:', error);
            showToast('Lỗi khi gửi đơn khiếu nại', 'error');
        });
    });

    // Camera luôn bật khi trang được tải xong
    startCamera();
    
    // Thay đổi nút check-in/check-out thành "Chấm công"
    const attendanceBtn = document.getElementById('attendanceBtn');
    
    // Xử lý sự kiện khi bấm nút chấm công
    attendanceBtn.addEventListener('click', function() {
        if (isProcessing) return;
        
        if (!lastFaceDetected || !detectedEmployee) {
            showToast('Vui lòng đứng thẳng và nhìn vào camera', 'warning');
            return;
        }
        
        isProcessing = true;
        loadingIndicator.classList.remove('d-none');
        
        const timestamp = new Date();
        
        fetch('/attendance', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                employee_id: detectedEmployee.id,
                check_time: timestamp.toISOString()
            })
        })
        .then(response => response.json())
        .then(data => {
            loadingIndicator.classList.add('d-none');
            
            if (data.success) {
                // Hiển thị hiệu ứng thành công
                showSuccessDetection();
                
                // Thông báo
                const message = data.is_check_in ? 
                    `Đã chấm công vào lúc ${timestamp.toLocaleTimeString()}` : 
                    `Đã cập nhật giờ ra về lúc ${timestamp.toLocaleTimeString()}`;
                    
                showToast(message, 'success');
                
                // Phát âm thanh
                playTTS(message);
                
                // Cập nhật danh sách nhân viên đang làm việc
                loadActiveEmployees();
                
                // Cập nhật thông tin nhân viên
                updateEmployeeInfo(detectedEmployee);
            } else {
                showToast(data.error, 'error');
            }
        })
        .catch(error => {
            console.error('Lỗi:', error);
            showToast('Có lỗi xảy ra khi chấm công', 'error');
        })
        .finally(() => {
            isProcessing = false;
            loadingIndicator.classList.add('d-none');
        });
    });

    // Xử lý đăng nhập admin
    const adminLoginSubmitBtn = document.getElementById('adminLoginSubmitBtn');
    if (adminLoginSubmitBtn) {
        adminLoginSubmitBtn.addEventListener('click', function() {
            const username = document.getElementById('adminUsername').value;
            const password = document.getElementById('adminPassword').value;
            
            if (!username || !password) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Thiếu thông tin',
                    text: 'Vui lòng nhập tên đăng nhập và mật khẩu',
                    confirmButtonColor: 'var(--accent-primary)'
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
            
            fetch('/admin-login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Đăng nhập thành công!',
                        text: 'Đang chuyển hướng đến trang quản trị...',
                        timer: 1500,
                        showConfirmButton: false,
                        willClose: () => {
                            window.location.href = data.redirect || '/admin';
                        }
                    });
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Đăng nhập thất bại',
                        text: data.message || 'Tên đăng nhập hoặc mật khẩu không đúng',
                        confirmButtonColor: 'var(--accent-primary)'
                    });
                }
            })
            .catch(error => {
                console.error('Lỗi khi đăng nhập:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Lỗi kết nối',
                    text: 'Có lỗi xảy ra khi đăng nhập. Vui lòng thử lại sau.',
                    confirmButtonColor: 'var(--accent-primary)'
                });
            });
        });
    }

    // Luôn mở camera khi trang tải xong
    startCamera();
    
    // Hàm đếm ngược khi phát hiện khuôn mặt liên tục
    function startFaceCountdown() {
        if (isCountingDown) return;
        
        isCountingDown = true;
        countdownValue = 3;
        countdownTimer.textContent = countdownValue;
        countdownContainer.classList.remove('d-none');
        
        const interval = setInterval(() => {
            countdownValue--;
            countdownTimer.textContent = countdownValue;
            
            if (countdownValue <= 0) {
                clearInterval(interval);
                countdownContainer.classList.add('d-none');
                isCountingDown = false;
                
                // Tự động chấm công
                if (detectedEmployee) {
                    attendanceBtn.click();
                }
            }
        }, 1000);
    }
    
    // Theo dõi khuôn mặt để bắt đầu đếm ngược
    function monitorFaceDetection() {
        if (lastFaceDetected && detectedEmployee && current_confidence > 0.75) {
            if (!faceDetectionTimer) {
                faceDetectionTimer = setTimeout(() => {
                    startFaceCountdown();
                    faceDetectionTimer = null;
                }, 2000); // Bắt đầu đếm ngược sau 2 giây nhìn thấy khuôn mặt
            }
        } else {
            if (faceDetectionTimer) {
                clearTimeout(faceDetectionTimer);
                faceDetectionTimer = null;
            }
            
            if (isCountingDown) {
                countdownContainer.classList.add('d-none');
                isCountingDown = false;
            }
        }
    }
    
    // Thêm vào sự kiện kiểm tra khuôn mặt
    function checkFaceStatus() {
        fetch('/face_status')
            .then(response => response.json())
            .then(data => {
                // Process data...
                
                // Update attendance button state
                updateAttendanceButtonState();
            });
    }
    
    // Cập nhật trạng thái nhân viên khi nhận diện thành công
    function updateEmployeeInfo(employee) {
        if (!employee) return;
        
        const employeeInfoCard = document.getElementById('employeeInfoCard');
        const employeeFullName = document.getElementById('employeeFullName');
        const employeeCode = document.getElementById('employeeCode');
        
        employeeInfoCard.classList.remove('d-none');
        employeeFullName.textContent = employee.name;
        employeeCode.textContent = employee.employee_code;
        
        // Cập nhật các thông tin khác nếu có
        if (employee.profile_image) {
            document.getElementById('employeeAvatar').src = '/' + employee.profile_image;
        }
        
        // Kiểm tra trạng thái chấm công
        fetch(`/employee-status/${employee.id}`)
            .then(response => response.json())
            .then(data => {
                const statusElement = document.getElementById('employeeStatus');
                if (data.checked_in && !data.checked_out) {
                    statusElement.innerHTML = `<span class="badge bg-success">Đang làm việc</span>`;
                } else if (data.checked_in && data.checked_out) {
                    statusElement.innerHTML = `<span class="badge bg-info">Đã check-out</span>`;
                } else {
                    statusElement.innerHTML = `<span class="badge bg-primary">Chưa chấm công</span>`;
                }
            });
    }

    // Khi phát hiện nhân viên thành công:
    // (Thêm lệnh này vào phần xử lý sau khi nhận diện thành công)
    if (detectedEmployee) {
        updateEmployeeInfo(detectedEmployee);
    }

    // Thêm hiệu ứng khi nhận diện thành công
    function showSuccessDetection() {
        const videoWrapper = document.querySelector('.video-wrapper');
        const statusOverlay = document.querySelector('.status-overlay');
        const statusContent = document.querySelector('.status-content');
        
        // Thêm class cho hiệu ứng
        videoWrapper.classList.add('success-detection');
        statusOverlay.classList.add('success');
        statusContent.classList.add('success');
        
        // Xóa class sau 3 giây
        setTimeout(() => {
            videoWrapper.classList.remove('success-detection');
            statusOverlay.classList.remove('success');
            statusContent.classList.remove('success');
        }, 3000);
    }

    // Kiểm tra và vô hiệu hóa nút chấm công khi không có nhân viên được nhận diện
    function updateAttendanceButtonState() {
        const attendanceBtn = document.getElementById('attendanceBtn');
        if (!attendanceBtn) return;
        
        if (detectedEmployee && lastFaceDetected && current_confidence > 0.75) {
            attendanceBtn.disabled = false;
            attendanceBtn.classList.add('active');
        } else {
            attendanceBtn.disabled = true;
            attendanceBtn.classList.remove('active');
        }
    }

    // Gọi hàm này khi trạng thái nhận diện thay đổi
    function checkFaceStatus() {
        fetch('/face_status')
            .then(response => response.json())
            .then(data => {
                // Process data...
                
                // Update attendance button state
                updateAttendanceButtonState();
            });
    }

    // Đảm bảo modal được khởi tạo đúng cách
    function configureModals() {
        // Kiểm tra xem Bootstrap đã được tải chưa
        if (typeof bootstrap === 'undefined') {
            console.error("Thư viện Bootstrap chưa được tải!");
            return;
        }
        
        console.log("Đang cấu hình modal...");
        
        // Thêm thuộc tính data-bs-toggle nếu chưa có
        const complaintBtn = document.getElementById('complaintBtn');
        if (complaintBtn && !complaintBtn.hasAttribute('data-bs-toggle')) {
            complaintBtn.setAttribute('data-bs-toggle', 'modal');
            complaintBtn.setAttribute('data-bs-target', '#complaintModal');
            console.log("Đã thêm thuộc tính modal toggle cho nút khiếu nại");
        }
        
        const adminLoginBtn = document.getElementById('adminLoginBtn');
        if (adminLoginBtn && !adminLoginBtn.hasAttribute('data-bs-toggle')) {
            adminLoginBtn.setAttribute('data-bs-toggle', 'modal');
            adminLoginBtn.setAttribute('data-bs-target', '#adminLoginModal');
            console.log("Đã thêm thuộc tính modal toggle cho nút quản lý");
        }
        
        // Thêm event listener trực tiếp nếu data-bs-toggle không hoạt động
        complaintBtn?.addEventListener('click', function() {
            console.log("Đã nhấn nút khiếu nại");
            try {
                const complaintModal = new bootstrap.Modal(document.getElementById('complaintModal'));
                complaintModal.show();
            } catch (error) {
                console.error("Lỗi khi mở modal khiếu nại:", error);
            }
        });
        
        adminLoginBtn?.addEventListener('click', function() {
            console.log("Đã nhấn nút quản lý");
            try {
                const adminLoginModal = new bootstrap.Modal(document.getElementById('adminLoginModal'));
                adminLoginModal.show();
            } catch (error) {
                console.error("Lỗi khi mở modal quản lý:", error);
            }
        });
        
        // Khởi tạo lại tất cả các modal
        document.querySelectorAll('.modal').forEach(function(modalEl) {
            try {
                new bootstrap.Modal(modalEl);
                console.log(`Khởi tạo modal ${modalEl.id} thành công`);
            } catch (error) {
                console.error(`Lỗi khi khởi tạo modal ${modalEl.id}:`, error);
            }
        });
    }

    // Thêm hàm updateConfidenceBar
    function updateConfidenceBar(confidence) {
        const confidenceBar = document.getElementById('confidenceBar');
        if (confidenceBar) {
            // Cập nhật độ rộng theo phần trăm
            const percent = confidence * 100;
            confidenceBar.style.width = `${percent}%`;
            
            // Thay đổi màu dựa trên mức độ tin cậy
            if (percent < 50) {
                confidenceBar.style.background = 'linear-gradient(to right, #ff4757, #ff6b81)'; // Đỏ
            } else if (percent < 75) {
                confidenceBar.style.background = 'linear-gradient(to right, #ffa502, #ff7f50)'; // Cam
            } else {
                confidenceBar.style.background = 'linear-gradient(to right, #00ccff, #00ff9d)'; // Xanh
            }
            
            // Thêm hiệu ứng glow khi độ tin cậy cao
            if (percent > 85) {
                confidenceBar.style.boxShadow = '0 0 10px rgba(0, 255, 157, 0.7)';
            } else {
                confidenceBar.style.boxShadow = 'none';
            }
        }
    }

    // Gọi hàm cập nhật độ tin cậy định kỳ
    setInterval(function() {
        fetch('/detection-status')
            .then(response => response.json())
            .then(data => {
                updateConfidenceBar(data.confidence || 0);
                
                // Cập nhật trạng thái nút chấm công
                const attendanceBtn = document.getElementById('attendanceBtn');
                if (attendanceBtn) {
                    if (data.face_detected && data.confidence > 0.7) {
                        attendanceBtn.disabled = false;
                        attendanceBtn.classList.remove('disabled');
                    } else {
                        attendanceBtn.disabled = true;
                        attendanceBtn.classList.add('disabled');
                    }
                }
            })
            .catch(error => console.error('Lỗi khi lấy thông tin nhận diện:', error));
    }, 500);

})
