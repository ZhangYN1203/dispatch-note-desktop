@echo off
chcp 65001 >nul
echo.
echo === 商品装具调拨单打印工具 - 开发模式 ===
echo.
echo 1. 安装依赖中...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo 安装依赖失败
    pause
    exit /b 1
)
echo.
echo 2. 启动开发服务器...
echo    请等待 Electron 窗口弹出（可能会打开两个窗口：Vite 服务器 + Electron）
echo.
call npm run electron:dev
pause
