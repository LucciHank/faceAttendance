// Khởi tạo các biến
let stream = null;
let capturedPhotos = [];
let isProcessing = false;
let currentPhotoIndex = 0;
const REQUIRED_PHOTOS = 5;
const PHOTO_INSTRUCTIONS = [
    "Vui lòng nhìn thẳng vào camera",
    "Xoay mặt sang trái 45 độ",
    "Xoay mặt sang phải 45 độ", 
    "Ngẩng đầu lên 30 độ",
    "Cúi đầu xuống 30 độ"
];

// Hàm phát âm hướng dẫn
async function speakInstruction(text) {
    try {
        const response = await fetch(`/tts?text=${encodeURIComponent(text)}`);
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        await audio.play();
    } catch (error) {
        console.error('TTS Error:', error);
    }
}

// Khởi tạo camera với độ phân giải cao
async function initCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: 640,
                height: 480,
                facingMode: "user"
            }
        });
        
        videoElement.srcObject = stream;
        await videoElement.play();
        
        startButton.disabled = true;
        captureButton.disabled = false;
        stopButton.disabled = false;

        // Phát hướng dẫn đầu tiên
        await speakInstruction(PHOTO_INSTRUCTIONS[0]);
        
    } catch (err) {
        console.error("Lỗi camera:", err);
        Swal.fire({
            icon: 'error',
            title: 'Không thể truy cập camera',
            text: 'Vui lòng kiểm tra quyền truy cập camera trong cài đặt trình duyệt',
            confirmButtonColor: 'var(--accent-primary)'
        });
    }
}

// Xử lý chụp ảnh với MTCNN
async function captureAndProcessFrame() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        // Hiển thị loading
        const progressBar = document.querySelector('.progress');
        progressBar.style.display = 'block';
        
        // Chụp frame hiện tại
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoElement, 0, 0);
        
        // Gửi frame lên server để xử lý với MTCNN
        const response = await fetch('/process_frame', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                frame: canvas.toDataURL('image/jpeg')
            })
        });

        const result = await response.json();
        
        if (result.success) {
            capturedPhotos.push(result.face_image);
            updateCapturedFaces();
            
            // Phát hướng dẫn tiếp theo
            if (currentPhotoIndex < REQUIRED_PHOTOS - 1) {
                currentPhotoIndex++;
                await speakInstruction(PHOTO_INSTRUCTIONS[currentPhotoIndex]);
            } else {
                await speakInstruction("Đã chụp đủ ảnh. Bạn có thể tiếp tục đăng ký.");
            }
        } else {
            throw new Error(result.error || 'Không phát hiện được khuôn mặt rõ nét');
        }
    } catch (error) {
        console.error('Capture Error:', error);
        Swal.fire({
            icon: 'error',
            title: 'Lỗi khi chụp ảnh',
            text: error.message
        });
    } finally {
        isProcessing = false;
        document.querySelector('.progress').style.display = 'none';
    }
}

// Cập nhật hiển thị ảnh đã chụp
function updateCapturedFaces() {
    const capturedFaces = document.getElementById('capturedFaces');
    
    if (capturedPhotos.length === 0) {
        capturedFaces.innerHTML = `
            <div class="captured-face-placeholder">
                <i class="fas fa-user-circle"></i>
                <span>Chưa có ảnh</span>
            </div>
        `;
        return;
    }

    capturedFaces.innerHTML = capturedPhotos.map((photo, index) => `
        <div class="captured-face-container">
            <img src="${photo}" class="captured-face" alt="Face ${index + 1}">
            <div class="face-overlay">
                <span class="face-number">${index + 1}/5</span>
                <button type="button" class="btn btn-danger btn-sm delete-face" 
                        onclick="deletePhoto(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `).join('');
}

// Xử lý submit form với xử lý embedding
async function handleFormSubmit(event) {
    event.preventDefault();
    
    // Lấy dữ liệu form
    const formData = new FormData(event.target);
    const employeeData = {
        employee_code: formData.get('employee_code'),
        name: formData.get('name'),
        department: formData.get('department'),
        position: formData.get('position'),
        photos: capturedPhotos // Mảng ảnh đã chụp
    };

    // Validate dữ liệu
    if (!employeeData.employee_code || !employeeData.name) {
        Swal.fire({
            icon: 'warning',
            title: 'Thiếu thông tin',
            text: 'Vui lòng điền đầy đủ mã nhân viên và họ tên',
            confirmButtonColor: 'var(--accent-primary)'
        });
        return;
    }

    if (capturedPhotos.length < REQUIRED_PHOTOS) {
        Swal.fire({
            icon: 'warning',
            title: 'Thiếu ảnh',
            text: `Vui lòng chụp đủ ${REQUIRED_PHOTOS} ảnh theo hướng dẫn`,
            confirmButtonColor: 'var(--accent-primary)'
        });
        return;
    }

    // Hiển thị loading
    Swal.fire({
        title: 'Đang xử lý...',
        text: 'Vui lòng đợi trong giây lát',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(employeeData)
        });

        const result = await response.json();

        if (result.success) {
            Swal.fire({
                icon: 'success',
                title: 'Đăng ký thành công!',
                text: 'Đã thêm nhân viên mới vào hệ thống',
                confirmButtonColor: 'var(--accent-primary)'
            }).then(() => {
                // Reset form và dữ liệu
                event.target.reset();
                capturedPhotos = [];
                currentPhotoIndex = 0;
                updateCapturedFaces();
            });
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        Swal.fire({
            icon: 'error',
            title: 'Lỗi',
            text: error.message || 'Không thể đăng ký nhân viên',
            confirmButtonColor: 'var(--accent-primary)'
        });
    }
}

// Gắn event handler vào form
document.getElementById('registerForm').addEventListener('submit', handleFormSubmit);

document.addEventListener('DOMContentLoaded', function() {
    const registerForm = document.getElementById('registerForm');
    const videoElement = document.getElementById('videoElement');
    let capturedImage = null;
    let isCapturing = false;

    // Chụp ảnh từ camera
    function captureImage() {
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoElement, 0, 0);
        return canvas.toDataURL('image/jpeg');
    }

    // Nút chụp ảnh
    document.getElementById('captureBtn').addEventListener('click', function() {
        if (!isCapturing) {
            capturedImage = captureImage();
            document.getElementById('previewImage').src = capturedImage;
            document.getElementById('imagePreview').style.display = 'block';
            this.textContent = 'Chụp lại';
            isCapturing = true;
        } else {
            capturedImage = null;
            document.getElementById('previewImage').src = '';
            document.getElementById('imagePreview').style.display = 'none';
            this.textContent = 'Chụp ảnh';
            isCapturing = false;
        }
    });

    // Khởi tạo camera khi trang load
    initCamera();
}); 