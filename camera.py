import queue
import cv2
import threading
from ai import detect_face, predict

class VideoStream:
    def __init__(self):
        self.video_capture = cv2.VideoCapture(0)
        self.video_capture.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.video_capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.video_capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.video_capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
        self.video_capture.set(cv2.CAP_PROP_FPS, 60)
        self.video_capture.set(cv2.CAP_PROP_AUTOFOCUS, 0)
        self.video_capture.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)
        
        self.frame_queue = queue.Queue(maxsize=1)
        self.running = True
        self.thread = threading.Thread(target=self.update_frame, daemon=True)
        self.thread.start()

    def update_frame(self):
        while self.running:
            ret, frame = self.video_capture.read()
            if ret:
                if not self.frame_queue.empty():
                    self.frame_queue.get()
                self.frame_queue.put(frame)
                
    def get_frame(self):
        return self.frame_queue.get() if not self.frame_queue.empty() else None

    def stop(self):
        self.running = False
        self.thread.join()
        self.video_capture.release()

def gen(set_predicted_label, train=False):
    video_stream = VideoStream()
    try:
        while True:
            frame = video_stream.get_frame()
            if frame is None:
                continue
            
            small_frame = cv2.resize(frame, (320, 240))  # Giảm kích thước để tăng tốc xử lý
            result = detect_face(small_frame)
            bbox = None
            face = None
            if result is not None:
                face, bbox = result
            
            if bbox is not None and face is not None and not train:
                x1, y1 = bbox[0]
                x2, y2 = bbox[2]
                cv2.rectangle(frame, (x1*2, y1*2), (x2*2, y2*2), (0, 255, 0), 2)  # Vẽ khung
                predicted_label = predict(face)
                set_predicted_label(predicted_label)
                if predicted_label:
                    cv2.putText(frame, predicted_label, (x1*2, y1*2 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
            else:
                set_predicted_label('')
            
            ret, buffer = cv2.imencode('.jpeg', frame)
            if not ret:
                continue
            
            frame_binary = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_binary + b'\r\n\r\n')
    finally:
        video_stream.stop()
 