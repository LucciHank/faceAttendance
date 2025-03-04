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
        fetch('/tts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: text })
        })
        .then(response => response.json())
        .then(data => {
            if (data.audio_url) {
                const audio = new Audio(data.audio_url);
                audio.play();
            }
        })
        .catch(error => console.error('Lỗi TTS:', error));
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
            workDuration.textContent = timeText;
            playTTS(`Thời gian làm việc của bạn là ${timeText}`);
            
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
});
