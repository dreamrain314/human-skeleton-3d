#!/bin/bash
# 人体骨骼 3D 交互模型 —— 一键启动（macOS / Linux）
cd "$(dirname "$0")" || exit 1
PORT=8765

# 找一个可用端口
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done

echo "======================================================"
echo "  人体骨骼 3D 交互模型"
echo "======================================================"
echo "  服务地址: http://localhost:$PORT"
echo "  按 Ctrl+C 可停止服务"
echo "======================================================"
echo

# 自动打开浏览器
( sleep 1.2; \
  if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"; \
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT"; \
  fi ) &

# 启动静态服务器（优先 python3，其次 node，最后 php）
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server $PORT
elif command -v python >/dev/null 2>&1; then
  exec python -m SimpleHTTPServer $PORT
elif command -v npx >/dev/null 2>&1; then
  exec npx --yes serve -l $PORT
elif command -v php >/dev/null 2>&1; then
  exec php -S localhost:$PORT
else
  echo "错误：未找到 python3 / node / php，无法启动本地服务器。"
  echo "请安装 Python 3 后重试，或手动用任意静态服务器托管本目录。"
  exit 1
fi
