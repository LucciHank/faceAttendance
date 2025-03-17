# video.py
import cv2
from ai import detect_face, predict

# Khởi tạo video capture
video_capture = cv2.VideoCapture(0)
video_capture.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
video_capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
video_capture.set(cv2.CAP_PROP_FPS, 30)
video_capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
video_capture.set(cv2.CAP_PROP_AUTOFOCUS, 0)
video_capture.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)
video_capture.set(cv2.CAP_PROP_SETTINGS, 1)

def gen(set_predicted_label, train=False):
    while True:
        ret, image = video_capture.read()
        if not ret: continue
        
        result = detect_face(image)
        bbox = None
        face = None
        if result is not None: 
            face, bbox = result
        
        if bbox is not None and face is not None and not train:
            x1, y1 = bbox[0]
            x2, y2 = bbox[2]
            cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 0), 2)
            predicted_label = predict(face)
            set_predicted_label(predicted_label)
            if predicted_label != '':
                cv2.putText(image, predicted_label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
        else:
            set_predicted_label('')  # Nếu không có khuôn mặt, đặt giá trị predicted_label rỗng
        
        ret, buffer = cv2.imencode('.jpeg', image)
        if not ret: continue       
        frame_binary = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_binary + b'\r\n\r\n')
