#!/bin/bash
# ============================================================
# 手写识别 OCR — 一键部署脚本 (Ubuntu / Alibaba Cloud)
# 用法: sudo bash deploy.sh
# ============================================================
set -e

PROJECT_DIR="/root/projects/handwriting-ocr"
DOMAIN="${1:-}"  # 传参: sudo bash deploy.sh your-domain.com

echo "========================================"
echo "  手写识别 OCR 部署"
echo "========================================"

# ── 1. 检查 Python 和依赖 ──
echo ""
echo "[1/5] 检查 Python 环境..."
cd "$PROJECT_DIR/backend"

if [ ! -d "venv311" ]; then
    python3.11 -m venv venv311
fi
source venv311/bin/activate
pip install -q -r requirements.txt 2>&1 | tail -1
echo "  ✓ 依赖安装完成"

# ── 2. 创建 systemd 服务 ──
echo ""
echo "[2/5] 配置 systemd 服务..."

cat > /etc/systemd/system/handwriting-ocr.service << 'SERVICEEOF'
[Unit]
Description=Handwriting OCR Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/projects/handwriting-ocr/backend
ExecStart=/root/projects/handwriting-ocr/backend/venv311/bin/python3 app.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable handwriting-ocr
systemctl restart handwriting-ocr
echo "  ✓ systemd 服务已启动 (端口 5000)"

# ── 3. 安装 Nginx ──
echo ""
echo "[3/5] 配置 Nginx..."

if ! command -v nginx &> /dev/null; then
    apt-get update -qq && apt-get install -y -qq nginx
fi

if [ -n "$DOMAIN" ]; then
    # ── 有域名：HTTPS 配置 ──
    cat > /etc/nginx/sites-available/handwriting-ocr << NGINXEOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$server\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINXEOF
    echo "  ✓ HTTPS 配置已生成（域名: $DOMAIN）"

    # ── 安装 certbot 获取证书 ──
    echo ""
    echo "[4/5] 获取 SSL 证书..."
    apt-get install -y -qq certbot python3-certbot-nginx
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" || true
    echo "  ✓ SSL 证书配置完成"

else
    # ── 无域名：HTTP 配置（相机不可用） ──
    cat > /etc/nginx/sites-available/handwriting-ocr << NGINXEOF
server {
    listen 80;
    server_name _;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
NGINXEOF
    echo ""
    echo "  ⚠ 未指定域名，使用 HTTP（相机功能不可用）"
    echo "    访问 https:// 需先绑定域名并重新运行:"
    echo "    sudo bash deploy.sh your-domain.com"
fi

# ── 启用 Nginx 站点 ──
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/handwriting-ocr /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo ""
echo "========================================"
echo "  ✅ 部署完成！"
if [ -n "$DOMAIN" ]; then
    echo "  访问: https://$DOMAIN"
    echo "  相机: ✅ 已启用 (HTTPS)"
else
    echo "  访问: http://服务器公网IP"
    echo "  相机: ❌ 不可用 (HTTP)，请使用"选择图片""
    echo "  修复: 绑定域名后运行 certbot 或重新部署"
fi
echo ""
echo "  管理命令:"
echo "    systemctl status handwriting-ocr    # 查看运行状态"
echo "    systemctl restart handwriting-ocr   # 重启服务"
echo "    tail -f /var/log/nginx/access.log   # 查看访问日志"
echo "========================================"
