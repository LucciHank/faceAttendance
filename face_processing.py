import cv2
import numpy as np
import mediapipe as mp
from models import Employee, get_db_connection, get_all_employees

# Khởi tạo MediaPipe Face Detection
mp_face_detection = mp.solutions.face_detection
mp_drawing = mp.solutions.drawing_utils
face_detection = mp_face_detection.FaceDetection(
    model_selection=0,
    min_detection_confidence=0.5
)

def extract_and_align_face(frame):
    """Phát hiện và căn chỉnh khuôn mặt từ frame"""
    if frame is None:
        return None
        
    # Chuyển frame sang RGB
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # Phát hiện khuôn mặt
    results = face_detection.process(rgb_frame)
    
    if results.detections:
        detection = results.detections[0]  # Lấy khuôn mặt đầu tiên
        
        # Lấy tọa độ bounding box
        bbox = detection.location_data.relative_bounding_box
        h, w, _ = frame.shape
        x = int(bbox.xmin * w)
        y = int(bbox.ymin * h)
        width = int(bbox.width * w)
        height = int(bbox.height * h)
        
        # Cắt khuôn mặt
        face = frame[y:y+height, x:x+width]
        
        # Resize về kích thước chuẩn
        face = cv2.resize(face, (224, 224))
        
        return face
    return None

def extract_embedding(face_img):
    """Trích xuất đặc trưng từ ảnh khuôn mặt"""
    # Đơn giản hóa: sử dụng histogram màu làm vector đặc trưng
    hist = cv2.calcHist([face_img], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
    hist = cv2.normalize(hist, hist).flatten()
    return hist

def identify_employee(embedding):
    """Nhận diện nhân viên từ embedding"""
    try:
        employees = get_all_employees()
        
        best_match = None
        highest_confidence = 0
        
        for employee in employees:
            if employee.face_embedding is not None:
                confidence = compare_embeddings(embedding, employee.face_embedding)
                
                if confidence > highest_confidence and confidence > 0.7:
                    highest_confidence = confidence
                    best_match = employee
        
        if best_match:
            return {
                'id': best_match.id,
                'name': best_match.name,
                'confidence': highest_confidence
            }
        return None
    except Exception as e:
        print(f"Lỗi nhận diện nhân viên: {str(e)}")
        return None

def compare_embeddings(embedding1, embedding2):
    """So sánh hai embedding vector"""
    # Sử dụng correlation coefficient làm độ tương đồng
    correlation = np.corrcoef(embedding1, embedding2)[0, 1]
    return max(0, correlation)  # Đảm bảo giá trị không âm

def draw_face_box(frame, x, y, width, height):
    """Vẽ bounding box và các thông tin lên khuôn mặt"""
    # Vẽ khung
    cv2.rectangle(frame, (x, y), (x + width, y + height), (0, 255, 0), 2)
    
    # Vẽ các điểm landmarks (nếu có)
    # landmarks = detection.location_data.relative_keypoints
    # h, w, _ = frame.shape
    # for kp in landmarks:
    #     kp_x = int(kp.x * w)
    #     kp_y = int(kp.y * h)
    #     cv2.circle(frame, (kp_x, kp_y), 2, (0, 0, 255), 2)
    
    return frame

def process_registration_video(company_id, employee_id, video_path):
    """Xử lý video đăng ký khuôn mặt"""
    try:
        cap = cv2.VideoCapture(video_path)
        frames = []
        confidences = []
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
                
            # Phát hiện khuôn mặt
            results = face_detection.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if results.detections:
                detection = results.detections[0]
                confidence = detection.score[0]
                
                if confidence > 0.7:  # Chỉ lấy frame có độ tin cậy cao
                    frames.append(frame)
                    confidences.append(confidence)
                    
                if len(frames) >= 5:  # Đủ 5 frame tốt nhất
                    break
                    
        cap.release()
        
        # Trích xuất embedding từ các frame
        embeddings = []
        for frame in frames:
            face_img = extract_and_align_face(frame)
            if face_img is not None:
                embedding = extract_embedding(face_img)
                embeddings.append(embedding)
        
        # Lưu embeddings vào database
        if embeddings:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Chuyển list embeddings thành bytes để lưu
            embeddings_bytes = np.array(embeddings).tobytes()
            
            cursor.execute("""
                UPDATE employee 
                SET face_embeddings = ?
                WHERE id = ? AND company_id = ?
            """, (embeddings_bytes, employee_id, company_id))
            
            # Cập nhật trạng thái đăng ký
            cursor.execute("""
                UPDATE face_registration
                SET status = ?, completed_at = CURRENT_TIMESTAMP
                WHERE employee_id = ? AND company_id = ?
            """, ('completed', employee_id, company_id))
            
            conn.commit()
            conn.close()
            
    except Exception as e:
        print(f"Lỗi xử lý video đăng ký: {str(e)}")
        # Cập nhật trạng thái lỗi
        conn = get_db_connection()
        conn.execute("""
            UPDATE face_registration
            SET status = 'error'
            WHERE employee_id = ? AND company_id = ?
        """, (employee_id, company_id))
        conn.commit()
        conn.close()

def draw_instruction_animation(frame, instruction):
    """Vẽ animation hướng dẫn lên frame"""
    h, w = frame.shape[:2]
    overlay = frame.copy()
    
    if "trái" in instruction.lower():
        # Vẽ mũi tên từ phải sang trái
        start_point = (int(w*0.8), int(h/2))
        end_point = (int(w*0.2), int(h/2))
        cv2.arrowedLine(overlay, start_point, end_point, 
                       (0,255,0), 3, tipLength=0.3)
    elif "phải" in instruction.lower():
        # Vẽ mũi tên từ trái sang phải  
        start_point = (int(w*0.2), int(h/2))
        end_point = (int(w*0.8), int(h/2))
        cv2.arrowedLine(overlay, start_point, end_point,
                       (0,255,0), 3, tipLength=0.3)
    elif "lên" in instruction.lower():
        # Vẽ mũi tên hướng lên
        start_point = (int(w/2), int(h*0.8))
        end_point = (int(w/2), int(h*0.2))
        cv2.arrowedLine(overlay, start_point, end_point,
                       (0,255,0), 3, tipLength=0.3)
    elif "xuống" in instruction.lower():
        # Vẽ mũi tên hướng xuống
        start_point = (int(w/2), int(h*0.2))
        end_point = (int(w/2), int(h*0.8))
        cv2.arrowedLine(overlay, start_point, end_point,
                       (0,255,0), 3, tipLength=0.3)
        
    # Thêm hiệu ứng mờ cho mũi tên
    alpha = 0.4
    frame = cv2.addWeighted(overlay, alpha, frame, 1-alpha, 0)
    
    # Thêm text hướng dẫn
    cv2.putText(frame, instruction, (10, h-20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255,255,255), 2)
                
    return frame 