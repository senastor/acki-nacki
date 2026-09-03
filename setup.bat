@echo off
title Acki-Nacki Auto Bot
color 0A

:MENU
cls
echo ============================================================
echo       Acki-Nacki Auto Bot - Setup and Run
echo ============================================================
echo.
echo Current directory: %CD%
echo.
echo 1. Create/Check Config Files
echo 2. Run the Bot
echo 3. Exit
echo.
set /p choice="Enter choice (1-3): "

if "%choice%"=="1" goto CONFIG
if "%choice%"=="2" goto RUN
if "%choice%"=="3" exit /b 0
echo Invalid choice
pause
goto MENU

:CONFIG
cls
if not exist .env (
    copy .env.example .env >nul
    echo Created .env from .env.example (edit with your TG bot token)
)
if not exist datas.txt (
    type nul > datas.txt
    echo Created datas.txt
)
if not exist proxies.txt (
    type nul > proxies.txt
    echo Created proxies.txt
)
if not exist wallets.txt (
    type nul > wallets.txt
    echo Created wallets.txt
)
echo.
echo Config files ready. Please fill datas.txt with your session data.
pause
goto MENU

:RUN
cls
if not exist datas.txt (
    echo datas.txt not found. Run option 1 first.
    pause
    goto MENU
)
echo Starting the bot...
node bot.js
pause
goto MENU
