@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 소원권 봇

echo.
echo  ==========================================
echo    소원권 봇
echo  ==========================================
echo.

REM ---------------------------------------------------------------
REM  실행 전 점검
REM ---------------------------------------------------------------

where node >nul 2>nul
if errorlevel 1 (
    echo  [X] Node.js 가 설치되어 있지 않습니다.
    echo      https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
    goto stop
)

if not exist "dist\index.js" (
    echo  [X] dist\index.js 가 없습니다.
    echo      릴리스 zip 을 푼 폴더가 맞는지 확인하세요.
    echo      ^(소스에서 실행한다면 먼저 npm run build^)
    goto stop
)

if not exist ".env" (
    if not exist ".env.example" (
        echo  [X] .env 가 없습니다. DISCORD_TOKEN 과 DISCORD_CLIENT_ID 가 필요합니다.
        goto stop
    )
    copy /y ".env.example" ".env" >nul
    echo  [!] .env 파일을 만들었습니다. 메모장이 열리면 토큰을 채우고 저장한 뒤
    echo      이 창을 닫고 다시 실행하세요.
    start "" notepad ".env"
    goto stop
)

findstr /r /c:"^DISCORD_TOKEN=..*" ".env" >nul
if errorlevel 1 (
    echo  [!] .env 의 DISCORD_TOKEN 이 비어 있습니다.
    echo      메모장이 열리면 값을 채우고 저장한 뒤 다시 실행하세요.
    start "" notepad ".env"
    goto stop
)

if not exist "node_modules" (
    echo  [*] 처음 실행이라 필요한 패키지를 설치합니다. 몇 분 걸릴 수 있습니다.
    echo.
    call npm ci --omit=dev
    if errorlevel 1 (
        echo.
        echo  [X] 패키지 설치에 실패했습니다.
        goto stop
    )
    echo.
)

REM  예약 실행이나 바로가기용:  run.bat bot   /   run.bat deploy
if /i "%~1"=="bot" goto bot
if /i "%~1"=="deploy" goto deploy

REM ---------------------------------------------------------------
REM  메뉴
REM ---------------------------------------------------------------

:menu
echo.
echo    1. 봇 실행
echo    2. 슬래시 커맨드 등록   ^(커맨드를 새로 만들거나 이름·옵션을 바꿨을 때만^)
echo    3. 종료
echo.
set "CHOICE="
set /p "CHOICE=  번호: "
if "%CHOICE%"=="1" goto bot
if "%CHOICE%"=="2" goto deploy
if "%CHOICE%"=="3" exit /b 0
goto menu

:deploy
echo.
node dist\deploy-commands.js
echo.
pause
goto menu

REM ---------------------------------------------------------------
REM  실행 — 예기치 않게 꺼지면 다시 켠다 (5번 연속 실패하면 멈춤)
REM ---------------------------------------------------------------

:bot
set TRIES=0

:bot_run
echo.
echo  [*] 봇을 시작합니다.  끄려면 이 창을 닫으세요.
echo.
node dist\index.js
set CODE=%ERRORLEVEL%

if "%CODE%"=="0" (
    echo.
    echo  [*] 정상적으로 종료되었습니다.
    goto stop
)

set /a TRIES+=1
if %TRIES% GEQ 5 (
    echo.
    echo  [X] 5번 연속으로 종료되었습니다. 위에 찍힌 오류를 확인해 주세요.
    echo      토큰이 틀렸거나 인텐트 설정이 빠진 경우가 많습니다.
    goto stop
)

echo.
echo  [!] 봇이 종료되었습니다 ^(코드 %CODE%^). 10초 뒤 다시 시작합니다. ^(%TRIES%/5^)
timeout /t 10 /nobreak >nul
goto bot_run

:stop
echo.
if "%~1"=="" pause
exit /b 1
