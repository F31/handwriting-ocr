import os
import uuid
from flask import Flask, request, jsonify, send_from_directory

from database import init_db, insert_note, insert_ocr_log, get_all_notes, get_note
from database import update_note, delete_note, search_notes
from ocr_engine import recognize_text, format_as_list

app = Flask(__name__, static_folder='../static', static_url_path='')

BASE_DIR = os.path.dirname(__file__)
UPLOAD_DIR = os.path.join(BASE_DIR, '..', 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}


def allowed_file(filename):
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS


# ─── Web Routes ───────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


# ─── API Routes ───────────────────────────────────────────────

@app.route('/api/ocr', methods=['POST'])
def ocr_upload():
    """Upload image → OCR → store → return result."""
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400

    file = request.files['image']
    if not file.filename or not allowed_file(file.filename):
        return jsonify({'error': 'Unsupported file type. Use jpg/png/webp'}), 400

    # Save uploaded image
    ext = os.path.splitext(file.filename)[1].lower()
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    file.save(filepath)

    # Perform OCR (map frontend lang to EasyOCR langs)
    lang_map = {
        'ch': ['ch_sim', 'en'],
        'en': ['en'],
    }
    lang_key = request.form.get('lang', 'ch')
    langs = lang_map.get(lang_key, ['ch_sim', 'en'])
    result = recognize_text(filepath, langs=langs)

    if not result['success']:
        return jsonify({'error': result['error']}), 500

    # Auto-format
    raw_text = result['raw_text']
    formatted = format_as_list(raw_text)

    # Auto-generate title (first line or first 30 chars)
    lines = [l.strip() for l in raw_text.strip().split('\n') if l.strip()]
    title = lines[0][:60] if lines else 'Untitled'

    # Store in database
    note_id = insert_note(title, raw_text, formatted, filename)
    insert_ocr_log(
        note_id=note_id,
        confidence=result['confidence'],
        raw_output=raw_text,
        duration_ms=result['duration_ms']
    )

    return jsonify({
        'id': note_id,
        'title': title,
        'raw_text': raw_text,
        'formatted': formatted,
        'lines': result['lines'],
        'confidence': result['confidence'],
        'duration_ms': result['duration_ms'],
        'image_url': f'/uploads/{filename}',
    })


@app.route('/api/notes', methods=['GET'])
def list_notes():
    q = request.args.get('q', '').strip()
    order = request.args.get('order', 'desc')
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)

    if q:
        notes = search_notes(q)
    else:
        notes = get_all_notes(order=order, limit=limit, offset=offset)

    for n in notes:
        if n['image_path']:
            n['image_url'] = f"/uploads/{n['image_path']}"

    return jsonify({'notes': notes, 'total': len(notes)})


@app.route('/api/notes/<int:note_id>', methods=['GET'])
def get_single_note(note_id):
    note = get_note(note_id)
    if not note:
        return jsonify({'error': 'Note not found'}), 404
    if note['image_path']:
        note['image_url'] = f"/uploads/{note['image_path']}"
    return jsonify(note)


@app.route('/api/notes/<int:note_id>', methods=['PUT'])
def update_single_note(note_id):
    data = request.get_json()
    title = data.get('title')
    formatted = data.get('formatted')
    update_note(note_id, title=title, formatted=formatted)
    return jsonify({'success': True})


@app.route('/api/notes/<int:note_id>', methods=['DELETE'])
def delete_single_note(note_id):
    note = get_note(note_id)
    if not note:
        return jsonify({'error': 'Note not found'}), 404
    # Delete image file
    if note['image_path']:
        img_path = os.path.join(UPLOAD_DIR, note['image_path'])
        if os.path.exists(img_path):
            os.remove(img_path)
    delete_note(note_id)
    return jsonify({'success': True})


# ─── Startup ──────────────────────────────────────────────────

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)
