document.addEventListener('DOMContentLoaded', function() {
    const videoStream = document.getElementById('videoStream');
    const instructionText = document.getElementById('instructionText');
    const countdown = document.getElementById('countdown');
    const previewContainer = document.getElementById('previewContainer');
    const startCaptureBtn = document.getElementById('startCapture');
    const retakeBtn = document.getElementById('retake');
    const submitBtn = document.getElementById('submit');

    let capturedImages = [];
    let currentStep = 0;
    let countdownInterval;

    const instructions = [
        "Vui lòng nhìn thẳng vào camera",
        "Quay mặt sang trái một chút",
        "Quay mặt sang phải một chút",
        "Ngửa mặt lên trên một chút",
        "Cúi mặt xuống một chút"
    ];

    // Khởi động camera
    videoStream.src = "/video_feed?show_bounding_box=false";

    // Hàm đọc hướng dẫn
    function speakInstruction(text) {
        fetch('/tts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: text })
        })
        .then(response => response.blob())
        .then(blob => {
            const audio = new Audio(URL.createObjectURL(blob));
            audio.play();
        });
    }

    // Hàm chụp ảnh
    async function captureImage() {
        try {
            // Kiểm tra khuôn mặt trước khi chụp
            const response = await fetch('/status');
            const data = await response.json();
            
            if (!data.face_detected || data.confidence < 0.8) {
                alert('Không phát hiện khuôn mặt hoặc độ tin cậy thấp. Vui lòng thử lại!');
                return;
            }

            // Tạo canvas với kích thước bằng video
            const canvas = document.createElement('canvas');
            const video = document.getElementById('videoStream');
            const width = video.naturalWidth || video.width;
            const height = video.naturalHeight || video.height;
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, width, height);
            
            // Chuyển đổi canvas thành base64
            const base64Image = canvas.toDataURL('image/jpeg', 0.9);
            capturedImages.push(base64Image.split(',')[1]);
            
            // Thêm preview
            const preview = document.createElement('div');
            preview.className = 'col-md-4';
            preview.innerHTML = `
                <div class="card preview-card">
                    <img src="${base64Image}" class="card-img-top">
                    <div class="card-body">
                        <p class="card-text">Ảnh ${currentStep + 1}</p>
                        <div class="confidence-badge">
                            Độ tin cậy: ${Math.round(data.confidence * 100)}%
                        </div>
                    </div>
                </div>
            `;
            previewContainer.appendChild(preview);
            
            // Kiểm tra số lượng ảnh
            if (capturedImages.length === instructions.length) {
                submitBtn.style.display = 'inline-block';
                retakeBtn.style.display = 'inline-block';
            }
        } catch (error) {
            console.error('Lỗi khi chụp ảnh:', error);
            alert('Có lỗi xảy ra khi chụp ảnh. Vui lòng thử lại!');
        }
    }

    // Hàm bắt đầu đếm ngược
    function startCountdown() {
        let timeLeft = 5;
        countdown.style.display = 'block';
        
        countdownInterval = setInterval(() => {
            if (timeLeft > 0) {
                countdown.textContent = timeLeft;
                timeLeft--;
            } else {
                clearInterval(countdownInterval);
                countdown.style.display = 'none';
                captureImage();
                nextStep();
            }
        }, 1000);
    }

    // Hàm chuyển bước tiếp theo
    function nextStep() {
        currentStep++;
        if (currentStep < instructions.length) {
            instructionText.textContent = instructions[currentStep];
            speakInstruction(instructions[currentStep]);
            startCountdown();
        } else {
            instructionText.textContent = "Đã hoàn thành chụp ảnh!";
            if (capturedImages.length === instructions.length) {
                submitBtn.style.display = 'inline-block';
                retakeBtn.style.display = 'inline-block';
            }
        }
    }

    // Event listeners
    startCaptureBtn.addEventListener('click', function() {
        this.style.display = 'none';
        instructionText.textContent = instructions[0];
        speakInstruction(instructions[0]);
        startCountdown();
    });

    retakeBtn.addEventListener('click', function() {
        capturedImages.pop();
        previewContainer.lastElementChild.remove();
        currentStep--;
        instructionText.textContent = instructions[currentStep];
        speakInstruction(instructions[currentStep]);
        startCountdown();
    });

    submitBtn.addEventListener('click', async function() {
        const employeeId = document.getElementById('employeeId').value;
        const employeeName = document.getElementById('employeeName').value;
        
        if (!employeeId || !employeeName) {
            alert('Vui lòng nhập đầy đủ thông tin!');
            return;
        }
        
        if (capturedImages.length !== instructions.length) {
            alert('Vui lòng chụp đủ 5 ảnh!');
            return;
        }
        
        try {
            const response = await fetch('/api/employees/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    employee_id: employeeId,
                    name: employeeName,
                    images: capturedImages
                })
            });
            
            const data = await response.json();
            if (data.success) {
                alert('Đăng ký thành công!');
                window.location.href = '/';
            } else {
                alert(data.message || 'Có lỗi xảy ra khi đăng ký!');
            }
        } catch (error) {
            console.error('Lỗi khi đăng ký:', error);
            alert('Có lỗi xảy ra khi đăng ký!');
        }
    });
}); 