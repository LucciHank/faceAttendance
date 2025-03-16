# from PIL import Image
import os
import cv2
import joblib
import requests
import numpy as np
import mediapipe as mp
import onnxruntime as ort
from sklearn.svm import SVC
from models import db, Embedding
directories = ['models']
model_dir = os.path.join(os.path.dirname(__file__), 'models')
rec_path = os.path.join(model_dir, 'face_recognition.onnx')
cls_path = os.path.join(model_dir, 'face_classifier.pkl')
url = 'https://thanglongedu-my.sharepoint.com/:u:/g/personal/a44212_thanglong_edu_vn/Ef3sjhgaRKNFqOrzTAi7ZgcBmef8hzm37GGOTTAZsuFTlw?download=1'
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    static_image_mode=False,  # False để sử dụng video (dynamic)
    max_num_faces=1,  # Số lượng khuôn mặt tối đa có thể phát hiện trong mỗi khung hình
    refine_landmarks=True,  # Lọc landmarks (điểm mốc) để có độ chính xác cao hơn
    min_detection_confidence=0.5,  # Mức độ tin cậy tối thiểu để phát hiện khuôn mặt
)

def load_model():
    #Kiểm tra sự tồn tại của các thư mục cần thiết
    for directory in directories:
        if not os.path.exists(directory):
            os.makedirs(directory)
            print(f"Thư mục '{directory}' đã được tạo.")
        else:
            print(f"Thư mục '{directory}' đã tồn tại.")
    #Kiểm tra File ONNX
    if not os.path.exists(rec_path):
        print("File ONNX chưa tồn tại, đang tải về...")
        response = requests.get(url)
        if response.status_code == 200:
            with open(rec_path, 'wb') as f:
                f.write(response.content)
            print("Tải file thành công.")
        else:
            print(f"Không thể tải file ONNX, mã trạng thái: {response.status_code}")
    rec_model = ort.InferenceSession(rec_path)
    print("Model ONNX sẵn sàng.")

    #Kiểm tra File SVC
    if not os.path.exists(cls_path):
        print("File SVC chưa tồn tại, đang tái tạo...")
        cls_model = SVC(kernel='linear', probability=True)
        joblib.dump(cls_model, cls_path)
    cls_model = joblib.load(cls_path)
    print("Model SVC sẵn sàng.")

    return rec_model, cls_model

rec_model, cls_model = load_model()

def detect_face(image):
    """
    Phát hiện khuôn mặt trong ảnh và trích xuất vùng mặt.
    - image: numpy array (ảnh gốc)
    - Trả về: numpy array (ảnh khuôn mặt) hoặc None nếu không tìm thấy
    """
    global mp_face_mesh, face_mesh
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(image_rgb)
    if results.multi_face_landmarks and len(results.multi_face_landmarks) > 0:
        face_landmarks = results.multi_face_landmarks[0].landmark
        img_h, img_w, _ = image.shape
        x_coords = [int(landmark.x * img_w) for landmark in face_landmarks]
        y_coords = [int(landmark.y * img_h) for landmark in face_landmarks]
        x1, x2 = min(x_coords), max(x_coords)
        y1, y2 = min(y_coords), max(y_coords)
        bbox = np.array([(x1, y1), (x2, y1), (x2, y2), (x1, y2)], dtype=np.int32)
        x1, y1, x2, y2 = max(0, x1), max(0, y1), min(img_w, x2), min(img_h, y2)
        return image[y1:y2, x1:x2], bbox
    return None, None

def train(files, employee_id):
    """
    Huấn luyện model với tập ảnh.
    - images: danh sách numpy array (các ảnh từ request)
    - employee_id: ID nhân viên tương ứng
    """
    global cls_model, cls_path, rec_model
    images = []
    for file in files:
        image_bytes = file.read()
        image_array = np.frombuffer(image_bytes, np.uint8)
        images.append(cv2.imdecode(image_array, cv2.IMREAD_COLOR))
    Embedding.query.filter_by(employee_id=employee_id).delete()
    db.session.commit()
    embeddings, labels = [], []
    # 🔹 Load tất cả embeddings cũ từ database trước khi train
    data = Embedding.query.all()
    for item in data:
        embeddings.append(np.frombuffer(item.embedding, dtype=np.float32).tolist())
        labels.append(item.employee_id)

    # 🔹 Thêm embeddings mới vào
    for image in images:
        face, bbox = detect_face(image)
        if face is None: continue
        img = cv2.resize(face, (160, 160))
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img = img.astype(np.float32) / 255.0
        img = (img - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
        img = np.transpose(img, (2, 0, 1))
        face_input = np.expand_dims(img, axis=0).astype(np.float32)
        output = rec_model.run(None, {rec_model.get_inputs()[0].name: face_input})
        embedding = output[0][0].tobytes()

        # Lưu vào database
        instance = Embedding(embedding=embedding, employee_id=employee_id)
        db.session.add(instance)
        db.session.commit()
        embeddings.append(np.frombuffer(embedding, dtype=np.float32).tolist())
        labels.append(employee_id)

    if len(set(labels)) == 1:
        print("Chỉ có một nhãn duy nhất, thêm embedding giả...")
        dummy_embedding = np.random.rand(len(embeddings[0])).tolist()
        embeddings.append(dummy_embedding)
        labels.append("unknown")

    cls_model = SVC(kernel='linear', probability=True)
    cls_model.fit(embeddings, labels)
    joblib.dump(cls_model, cls_path)
    return {'status': 'Thành công', 'classes': cls_model.classes_.tolist()}

def predict(face):
    """
    Dự đoán danh tính khuôn mặt từ ảnh.
    - image: numpy array (ảnh gốc)
    - Trả về: employee_id dự đoán hoặc lỗi nếu không tìm thấy mặt
    """
    global cls_model, rec_model
    img = cv2.resize(face, (160, 160))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = img.astype(np.float32) / 255.0
    img = (img - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    img = np.transpose(img, (2, 0, 1))
    face_input = np.expand_dims(img, axis=0).astype(np.float32)
    outputs = rec_model.run(None, {rec_model.get_inputs()[0].name: face_input})
    predicted_label = cls_model.predict(outputs[0])
    return predicted_label[0]
