from flask import Flask, Response, render_template, jsonify, request, url_for
import cv2
import time
import threading
import os
from gtts import gTTS
import uuid
import mediapipe as mp
from datetime import datetime

# Tắt các warning không cần thiết
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

app = Flask(__name__)

# Khởi tạo các biến global
camera = None
camera_lock = threading.Lock()
camera_running = False

# Khởi tạo MediaPipe Face Detection
mp_face_detection = mp.solutions.face_detection
mp_drawing = mp.solutions.drawing_utils
face_detection = mp_face_detection.FaceDetection(
    model_selection=0,  # Model 0 tối ưu cho khoảng cách gần (<2m)
    min_detection_confidence=0.5
)

# Biến theo dõi trạng thái
current_confidence = 0.0
face_detected = False
last_detection_time = 0
detection_status = "Chưa phát hiện"

def init_camera():
    """Khởi tạo và kiểm tra camera"""
    global camera
    try:
        if camera is None:
            print("Đang kết nối camera...")
            camera = cv2.VideoCapture(0, cv2.CAP_DSHOW)
            camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            
            if not camera.isOpened():
                print("Không thể kết nối camera!")
                return False
                
            ret, frame = camera.read()
            if not ret:
                print("Không thể đọc frame từ camera!")
                camera.release()
                camera = None
                return False
                
            return True
        return True
    except Exception as e:
        print(f"Lỗi khi khởi tạo camera: {str(e)}")
        if camera is not None:
            camera.release()
            camera = None
        return False

def process_frame(frame):
    """Xử lý frame với MediaPipe Face Detection"""
    global current_confidence, face_detected, last_detection_time
    
    try:
        # Chuyển frame sang RGB vì MediaPipe yêu cầu đầu vào là RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = face_detection.process(frame_rgb)
        
        if results.detections:
            face_detected = True
            detection = results.detections[0]  # Lấy khuôn mặt đầu tiên
            current_confidence = detection.score[0]
            last_detection_time = time.time()
            
            # Vẽ khuôn mặt
            bbox = detection.location_data.relative_bounding_box
            h, w, _ = frame.shape
            x = int(bbox.xmin * w)
            y = int(bbox.ymin * h)
            width = int(bbox.width * w)
            height = int(bbox.height * h)
            
            # Chỉ vẽ rectangle
            cv2.rectangle(frame, (x, y), (x + width, y + height), (0, 255, 0), 2)
        else:
            face_detected = False
            current_confidence = 0.0
                
    except Exception as e:
        print(f"Lỗi khi xử lý frame: {str(e)}")
        face_detected = False
        current_confidence = 0.0
        
    return frame

def generate_frames():
    """Generator để stream video"""
    global camera, camera_running
    
    if not init_camera():
        return
        
    camera_running = True
    while camera_running:
        try:
            with camera_lock:
                success, frame = camera.read()
                if not success:
                    break
                    
                # Xử lý frame
                frame = process_frame(frame)
                
                # Chuyển frame thành jpg
                ret, buffer = cv2.imencode('.jpg', frame)
                frame = buffer.tobytes()
                
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
                   
        except Exception as e:
            print(f"Lỗi khi generate frame: {str(e)}")
            break
            
    release_camera()

def release_camera():
    """Giải phóng camera"""
    global camera
    with camera_lock:
        if camera is not None:
            camera.release()
            camera = None

@app.route('/')
def index():
    """Trang chủ"""
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    """Video stream route"""
    try:
        return Response(generate_frames(),
                       mimetype='multipart/x-mixed-replace; boundary=frame')
    except Exception as e:
        print(f"Lỗi stream video: {str(e)}")
        return "Video stream error", 500

@app.route('/status')
def get_status():
    """API endpoint để lấy trạng thái hiện tại"""
    current_time = time.strftime("%H:%M:%S")
    return jsonify({
        "time": current_time,
        "confidence": current_confidence,
        "face_detected": face_detected  # Chỉ cần trả về trạng thái phát hiện
    })

@app.route('/tts', methods=['POST'])
def text_to_speech():
    """API endpoint để tạo file audio từ text"""
    data = request.get_json()
    text = data.get('text', '')
    
    if not text:
        return jsonify({'error': 'No text provided'}), 400
    
    try:
        # Tạo tên file độc nhất
        filename = f"tts_{uuid.uuid4()}.mp3"
        filepath = os.path.join('static', 'audio', filename)
        
        # Đảm bảo thư mục tồn tại
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        # Tạo file audio bằng gTTS
        tts = gTTS(text=text, lang='vi')
        tts.save(filepath)
        
        # Trả về URL của file audio
        audio_url = url_for('static', filename=f'audio/{filename}')
        return jsonify({'audio_url': audio_url})
    except Exception as e:
        print(f"Lỗi khi tạo audio: {str(e)}")
        return jsonify({'error': 'Lỗi khi tạo audio'}), 500

@app.route('/cleanup_audio', methods=['POST'])
def cleanup_audio():
    """API endpoint để dọn dẹp file audio cũ"""
    audio_dir = os.path.join('static', 'audio')
    if os.path.exists(audio_dir):
        for file in os.listdir(audio_dir):
            if file.startswith('tts_'):
                try:
                    os.remove(os.path.join(audio_dir, file))
                except:
                    pass
    return jsonify({'status': 'success'})

if __name__ == '__main__':
    app.run(debug=True)
