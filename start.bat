@echo off
rem 人体骨骼 3D 交互模型 —— 一键启动（Windows）
title 人体骨骼 3D 交互模型
cd /d "%~dp0"

set PORT=8765

echo ======================================================
echo   人体骨骼 3D 交互模型
echo ======================================================
echo   正在启动本地服务器，请勿关闭本窗口
echo   关闭本窗口即可停止服务
echo ======================================================
echo.

rem 端口被占用则自动顺延
:CHECKPORT
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>nul
if %errorlevel%==0 (
  set /a PORT+=1
  goto CHECKPORT
)

echo [*] 服务端口: %PORT%
echo [*] 浏览器将打开 http://localhost:%PORT%
echo.
start "" "http://localhost:%PORT%"

where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto END
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server %PORT%
  goto END
)

where npx >nul 2>nul
if %errorlevel%==0 (
  npx --yes serve -l %PORT%
  goto END
)

echo.
echo [错误] 未找到 Python 或 Node.js，无法启动本地服务器。
echo.
echo 请先安装 Python 3: https://www.python.org/downloads/
echo 安装时务必勾选 "Add Python to PATH"，安装后重新双击本文件。
echo.
pause
goto :eof

:END
echo.
echo 服务已停止。按任意键关闭本窗口...
pause >nul
