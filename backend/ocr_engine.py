import os
import sys
import time
import json
import subprocess
import signal

# ─── PaddlePaddle flags (MUST be set before any paddle import) ───
os.environ.setdefault('FLAGS_enable_ir_optim', '0')
os.environ.setdefault('FLAGS_enable_pir_api', '0')
os.environ.setdefault('PPOCR_LOG', '0')
os.environ.setdefault('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK', '1')
os.environ.setdefault('GLOG_minloglevel', '2')

# Don't import PaddleOCR at module level - let subprocess handle availability
_paddle_available = True  # Always try subprocess; failure is handled there


def _import_paddleocr():
    """Import PaddleOCR after env flags are guaranteed to be set."""
    import warnings
    warnings.filterwarnings('ignore')
    from paddleocr import PaddleOCR
    return PaddleOCR


def recognize_text(image_path, langs=None):
    """
    Recognize text from an image using PaddleOCR (subprocess mode).

    Args:
        image_path: full path to image file
        langs: language hint (unused, for API compatibility)

    Returns:
        dict with keys: success, raw_text, lines, confidence, duration_ms, error
    """
    start = time.time()

    if not _paddle_available:
        return {
            'success': False,
            'error': 'PaddleOCR 未安装，请执行: pip install paddleocr',
            'raw_text': '', 'lines': [], 'confidence': 0.0,
            'duration_ms': int((time.time() - start) * 1000),
        }

    return _recognize_subprocess(image_path, start)


def _recognize_subprocess(image_path, start):
    """Run OCR in a subprocess so crashes don't kill the main server."""
    worker = os.path.join(os.path.dirname(__file__), 'ocr_engine.py')

    try:
        # Use Chinese model (the SIGILL bug is fixed via monkey-patch)
        proc = subprocess.run(
            [sys.executable, worker, image_path, 'ch'],
            capture_output=True, text=True, timeout=120,
            env={
                **os.environ,
                'FLAGS_enable_ir_optim': '0',
                'FLAGS_enable_pir_api': '0',
                'PPOCR_LOG': '0',
                'PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK': '1',
                'GLOG_minloglevel': '2',
                'PYTHONWARNINGS': 'ignore',
                'OMP_NUM_THREADS': '1',
                'MKL_NUM_THREADS': '1',
            },
        )

        elapsed = int((time.time() - start) * 1000)

        if proc.returncode < 0:
            sig = -proc.returncode
            if sig == signal.SIGILL:
                return {
                    'success': False,
                    'error': 'CPU 不兼容 (SIGILL)。请尝试安装 no-avx 版 PaddlePaddle:\n'
                             'pip install paddlepaddle==2.6.2 -f '
                             'https://paddle-wheel.bj.bcebos.com/?version=2.6.2&kind=no_avx',
                    'raw_text': '', 'lines': [], 'confidence': 0.0,
                    'duration_ms': elapsed,
                }
            return {
                'success': False,
                'error': f'OCR 进程被信号 {sig} 终止',
                'raw_text': '', 'lines': [], 'confidence': 0.0,
                'duration_ms': elapsed,
            }

        if proc.returncode != 0:
            error_msg = (proc.stderr.strip() or '未知错误')[:500]
            return {
                'success': False, 'error': error_msg,
                'raw_text': '', 'lines': [], 'confidence': 0.0,
                'duration_ms': elapsed,
            }

        try:
            data = json.loads(proc.stdout.strip())
        except json.JSONDecodeError:
            return {
                'success': False,
                'error': f'OCR 输出解析失败: {proc.stdout[:200]}',
                'raw_text': '', 'lines': [], 'confidence': 0.0,
                'duration_ms': elapsed,
            }

        if not data.get('success'):
            return {
                'success': False, 'error': data.get('error', '识别失败'),
                'raw_text': '', 'lines': [], 'confidence': 0.0,
                'duration_ms': elapsed,
            }

        data['duration_ms'] = elapsed
        data['error'] = None
        return data

    except subprocess.TimeoutExpired:
        elapsed = int((time.time() - start) * 1000)
        return {
            'success': False, 'error': 'OCR 超时，请检查图片大小',
            'raw_text': '', 'lines': [], 'confidence': 0.0,
            'duration_ms': elapsed,
        }
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return {
            'success': False, 'error': str(e),
            'raw_text': '', 'lines': [], 'confidence': 0.0,
            'duration_ms': elapsed,
        }


def format_as_list(raw_text):
    """Auto-format raw text into structured markdown."""
    lines = [l.strip() for l in raw_text.strip().split('\n') if l.strip()]
    if not lines:
        return ''

    if len(lines) == 1:
        return f"# {lines[0]}"

    if len(lines[0]) < 50:
        body = lines[1:]
        formatted = [f"# {lines[0]}", ""]
        for line in body:
            if line.endswith(('。', '！', '？', '.', '!', '?')):
                formatted.append(line)
            elif len(line) > 30:
                formatted.append(line)
            else:
                formatted.append(f"- {line}")
        return '\n'.join(formatted)

    formatted = []
    for line in lines:
        if len(line) > 30:
            formatted.append(line)
        else:
            formatted.append(f"- {line}")
    return '\n'.join(formatted)


# ═══════════════════════════════════════════════════════════════
# Subprocess entry point
# When run directly: python ocr_engine.py <image_path>
# ═══════════════════════════════════════════════════════════════

def _run_worker():
    """
    Worker entry for subprocess mode.
    Usage: python ocr_engine.py <image_path> [lang]
    Environment flags are set BEFORE any PaddlePaddle modules are loaded.
    """
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': '缺少图片路径参数'}))
        return

    image_path = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else 'ch'

    # ── CRITICAL: Set flags BEFORE importing paddle ──
    os.environ['FLAGS_enable_ir_optim'] = '0'
    os.environ['FLAGS_enable_pir_api'] = '0'
    os.environ['PPOCR_LOG'] = '0'
    os.environ['GLOG_minloglevel'] = '2'
    os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = '1'
    os.environ['OMP_NUM_THREADS'] = '1'
    os.environ['MKL_NUM_THREADS'] = '1'

    # ── FIX: Disable SelfAttentionFusePass (causes SIGILL on some CPUs) ──
    import paddle.inference as inference
    _orig_create = inference.create_predictor
    def _patched_create(config):
        try:
            config.delete_pass('self_attention_fuse_pass')
        except Exception:
            pass
        return _orig_create(config)
    inference.create_predictor = _patched_create

    import warnings
    warnings.filterwarnings('ignore')
    from paddleocr import PaddleOCR

    try:
        ocr = PaddleOCR(
            use_angle_cls=True, lang=lang,
            show_log=False, use_gpu=False,
        )
    except Exception as e:
        print(json.dumps({'success': False, 'error': f'初始化失败: {e}'}))
        return

    try:
        result = ocr.ocr(image_path, cls=True)
        lines = []
        confidences = []
        full_text = []

        if result and result[0]:
            for line in result[0]:
                box, (text, confidence) = line[0], line[1]
                flat_box = [round(float(c), 1) for pt in box for c in pt]
                lines.append({
                    'text': text,
                    'confidence': round(confidence, 4),
                    'box': flat_box,
                })
                full_text.append(text)
                confidences.append(confidence)

        avg_conf = round(sum(confidences) / len(confidences), 4) if confidences else 0.0

        print(json.dumps({
            'success': True,
            'raw_text': '\n'.join(full_text),
            'lines': lines,
            'confidence': avg_conf,
        }))

    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))


if __name__ == '__main__':
    _run_worker()
