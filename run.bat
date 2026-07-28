@echo off
rem ---------------------------------------------------------------
rem  Everything above :main must stay ASCII-only.
rem
rem  cmd reads a batch file by byte offset and decodes it with the
rem  code page that is active at that moment. Calling chcp in the
rem  middle of the file shifts those offsets, which cuts multi-byte
rem  lines in half and makes cmd run the leftover as a command.
rem  So: switch the code page first, then re-run this file. The whole
rem  script is then parsed under one code page.
rem ---------------------------------------------------------------
if "%YDGRB_UTF8%"=="1" goto main
set "YDGRB_UTF8=1"
chcp 65001 >nul
cmd /d /s /c ""%~f0" %*"
exit /b %errorlevel%

:main
cd /d "%~dp0"
title 소원권 봇

set "REPO=MAIJEUN/YDGRB"

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

REM  업데이트를 막 받았다면 의존성이 늘었을 수 있으므로 다시 설치한다.
if exist ".update-applied" (
    del /q ".update-applied" >nul 2>nul
    echo  [*] 업데이트를 적용했습니다. 패키지를 다시 확인합니다.
    echo.
    call npm ci --omit=dev
    echo.
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
REM  그때는 물어볼 사람이 없으므로 업데이트 확인을 건너뛴다.
if /i "%~1"=="bot" goto bot
if /i "%~1"=="deploy" goto deploy

call :check_update

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

REM  입력이 끊기면(파이프로 실행되는 등) set /p 가 그냥 지나간다.
REM  그대로 두면 메뉴가 무한히 돌므로 몇 번 비면 끝낸다.
set /a EMPTY+=1
if not defined CHOICE if %EMPTY% GEQ 3 (
    echo  [X] 입력을 읽지 못했습니다.
    exit /b 1
)
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

REM ---------------------------------------------------------------
REM  업데이트 확인
REM
REM  GitHub 최신 릴리스의 태그를 VERSION 파일과 견준다.
REM  받겠다고 하면 zip 을 받아 풀고, 덮어쓰기는 임시 폴더의 도우미가 한다 —
REM  실행 중인 run.bat 을 자기 자신이 덮어쓸 수는 없기 때문이다.
REM ---------------------------------------------------------------

:check_update
if not exist "VERSION" (
    REM  소스에서 바로 돌리는 경우. 견줄 값이 없으니 조용히 넘어간다.
    goto :eof
)

set "CURRENT="
set /p "CURRENT=" < "VERSION"
if not defined CURRENT goto :eof

echo  [*] 업데이트를 확인합니다...

set "LATEST="
REM  -TimeoutSec 를 꼭 준다. 없으면 인터넷이 막혀 있을 때 실행기가 통째로 멈춰 버린다.
for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { (Invoke-RestMethod 'https://api.github.com/repos/%REPO%/releases/latest' -Headers @{'User-Agent'='ydgrb'} -TimeoutSec 5).tag_name } catch { '' }"`) do set "LATEST=%%A"

if not defined LATEST (
    echo  [!] 확인하지 못했습니다. 그냥 진행합니다.
    goto :eof
)

if "%LATEST%"=="%CURRENT%" (
    echo  [*] 최신 버전입니다 ^(YDGRB%CURRENT%^).
    goto :eof
)

echo.
echo  ------------------------------------------
echo    새 버전이 있습니다
echo      지금  YDGRB%CURRENT%
echo      최신  YDGRB%LATEST%
echo  ------------------------------------------
echo.
set "ANSWER="
set /p "ANSWER=  지금 업데이트할까요? (Y/N): "
if /i not "%ANSWER%"=="Y" (
    echo  [*] 건너뜁니다.
    goto :eof
)

goto :do_update

:do_update
set "ZIP=%TEMP%\YDGRB%LATEST%.zip"
set "UNPACK=%TEMP%\ydgrb-update"
set "HELPER=%TEMP%\ydgrb-apply.bat"

echo.
echo  [*] 내려받는 중...
curl -L --fail --silent --show-error -o "%ZIP%" "https://github.com/%REPO%/releases/download/%LATEST%/YDGRB%LATEST%.zip"
if errorlevel 1 (
    echo  [X] 내려받지 못했습니다. 그냥 진행합니다.
    goto :eof
)

if exist "%UNPACK%" rd /s /q "%UNPACK%"
mkdir "%UNPACK%"

echo  [*] 푸는 중...
tar -xf "%ZIP%" -C "%UNPACK%"
if errorlevel 1 (
    echo  [X] 압축을 풀지 못했습니다. 그냥 진행합니다.
    goto :eof
)

REM  덮어쓰기는 이 창이 닫힌 뒤에 해야 한다. 도우미를 만들어 넘긴다.
REM  ^> ^& %% 는 지금 실행되지 않고 파일에 그대로 적히도록 escape 한 것이다.
REM
REM  VERSION 은 zip 에 든 것을 덮어쓰고 나서 방금 받은 태그로 다시 적는다 —
REM  zip 에 VERSION 이 빠져 있어도 버전이 어긋나 매번 다시 묻는 일이 없도록.
(
    echo @echo off
    echo chcp 65001 ^>nul
    echo ping -n 3 127.0.0.1 ^>nul
    echo xcopy /e /i /y "%UNPACK%\*" "%CD%\" ^>nul
    echo ^<nul set /p "=%LATEST%"^> "%CD%\VERSION"
    echo echo 1^> "%CD%\.update-applied"
    echo rd /s /q "%UNPACK%"
    echo del /q "%ZIP%"
    echo start "" "%CD%\run.bat"
    echo ^(goto^) 2^>nul ^& del "%%~f0"
) > "%HELPER%"

echo  [*] 적용하고 다시 시작합니다.
start "" "%HELPER%"
exit /b 0
