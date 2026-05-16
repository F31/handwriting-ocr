#!/bin/bash
# PaddleOCR 手写识别系统 - 一键安装脚本
# 要求: Python 3.10 或 3.11

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

echo "=================================="
echo "  手写文字识别系统 - 安装脚本"
echo "=================================="
echo ""

# 检查 Python 版本
PYTHON=""
for cmd in python3.11 python3.10 python3; do
    if command -v "$cmd" &>/dev/null; then
        ver=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+')
        major=${ver%.*}
        minor=${ver#*.}
        if [ "$major" -ge 3 ] && [ "$minor" -ge 10 ] && [ "$minor" -le 11 ]; then
            PYTHON="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo "❌ 需要 Python 3.10 或 3.11。"
    echo "   Ubuntu/Debian: sudo apt install python3.11 python3.11-venv"
    echo "   macOS: brew install python@3.11"
    exit 1
fi

echo "  使用 Python: $($PYTHON --version)"

# 1. 虚拟环境
echo "[1/4] 创建虚拟环境..."
"$PYTHON" -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
echo "  ✅ 虚拟环境"

# 2. Flask
echo "[2/4] 安装 Flask..."
pip install "flask>=3.0" -q
echo "  ✅ Flask"

# 3. PaddlePaddle (no-avx 版本兼容性更好)
echo "[3/4] 安装 PaddlePaddle..."
if pip install "paddlepaddle==2.6.2" \
    -f "https://paddle-wheel.bj.bcebos.com/?version=2.6.2&kind=no_avx" \
    -q 2>/dev/null; then
    echo "  ✅ PaddlePaddle (no-avx)"
else
    pip install "paddlepaddle<3.0" -q
    echo "  ✅ PaddlePaddle (standard)"
fi

# 4. PaddleOCR
echo "[4/4] 安装 PaddleOCR..."
pip install "paddleocr>=2.8,<3.0" -q
echo "  ✅ PaddleOCR"

echo ""
echo "=================================="
echo "  ✅ 安装完成！"
echo "=================================="
echo ""
echo "启动服务:"
echo "  source venv/bin/activate"
echo "  python backend/app.py"
echo ""
echo "手机浏览器访问:"
echo "  http://$(hostname -I | awk '{print $1}'):5000"
echo ""
