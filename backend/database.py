import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), 'notes.db')


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS notes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            title       TEXT    NOT NULL DEFAULT '',
            raw_text    TEXT    NOT NULL DEFAULT '',
            formatted   TEXT    NOT NULL DEFAULT '',
            image_path  TEXT    NOT NULL DEFAULT '',
            created_at  TEXT    NOT NULL,
            updated_at  TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ocr_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            confidence  REAL    NOT NULL DEFAULT 0.0,
            raw_output  TEXT    NOT NULL DEFAULT '',
            duration_ms INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT    NOT NULL
        );
    """)
    conn.commit()
    conn.close()


def insert_note(title, raw_text, formatted, image_path):
    now = datetime.now().isoformat(timespec='seconds')
    conn = get_connection()
    conn.execute(
        "INSERT INTO notes (title, raw_text, formatted, image_path, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (title, raw_text, formatted, image_path, now, now)
    )
    conn.commit()
    note_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return note_id


def insert_ocr_log(note_id, confidence, raw_output, duration_ms):
    now = datetime.now().isoformat(timespec='seconds')
    conn = get_connection()
    conn.execute(
        "INSERT INTO ocr_log (note_id, confidence, raw_output, duration_ms, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (note_id, confidence, raw_output, duration_ms, now)
    )
    conn.commit()
    conn.close()


def get_all_notes(order='desc', limit=50, offset=0):
    conn = get_connection()
    direction = 'DESC' if order == 'desc' else 'ASC'
    rows = conn.execute(
        f"SELECT id, title, raw_text, formatted, image_path, created_at, updated_at "
        f"FROM notes ORDER BY created_at {direction} LIMIT ? OFFSET ?",
        (limit, offset)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_note(note_id):
    conn = get_connection()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_note(note_id, title=None, formatted=None):
    now = datetime.now().isoformat(timespec='seconds')
    fields = []
    values = []
    if title is not None:
        fields.append("title = ?")
        values.append(title)
    if formatted is not None:
        fields.append("formatted = ?")
        values.append(formatted)
    if not fields:
        return False
    fields.append("updated_at = ?")
    values.append(now)
    values.append(note_id)
    conn = get_connection()
    conn.execute(f"UPDATE notes SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return True


def delete_note(note_id):
    conn = get_connection()
    conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    conn.commit()
    conn.close()


def search_notes(keyword):
    conn = get_connection()
    pattern = f"%{keyword}%"
    rows = conn.execute(
        "SELECT id, title, raw_text, formatted, image_path, created_at, updated_at "
        "FROM notes WHERE raw_text LIKE ? OR formatted LIKE ? OR title LIKE ? "
        "ORDER BY created_at DESC",
        (pattern, pattern, pattern)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
