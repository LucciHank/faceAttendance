from flask import Flask, render_template, Response, request
from models import db, Config
from api import api_bp
from camera import gen

app = Flask(__name__)
predicted_label = ""
app.config.from_object(Config)
db.init_app(app)
with app.app_context():
    db.create_all()

# Toàn bộ các API sẽ đều phải truy cập thông qua route /api
# VD: /api/checkin
app.register_blueprint(api_bp, url_prefix='/api')

def set_predicted_label(value):
    global predicted_label
    predicted_label = value

# Các route giao diện
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/train')
def train():
    return render_template('train.html')

# Stream Video lên trình duyệt
@app.route('/video_feed')
def video_feed():
    train = request.args.get('train', 'false').lower() == 'true'
    return Response(gen(set_predicted_label, train), mimetype='multipart/x-mixed-replace; boundary=frame')

# Stream kết quả Label trên trình duyệt
@app.route('/get_label')
def get_label():
    def event_stream():
        global predicted_label
        while True:
            yield f"data: {predicted_label}\n\n"
    return Response(event_stream(), content_type='text/event-stream')

if __name__ == '__main__':
    app.run(debug=True)
