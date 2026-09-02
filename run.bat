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
rem
rem  The run-and-exit below is ONE line on purpose. cmd reads a whole
rem  line into memory before running it, so once this line is read the
rem  file may be replaced underneath us without derailing what follows.
rem  An update does exactly that. Do not split it back into two lines.
rem  (exit /b takes no code here: %errorlevel% would be expanded when
rem  the line is read, which is before the child has even started.)
rem ---------------------------------------------------------------
if "%YDGRB_UTF8%"=="1" goto main
set "YDGRB_UTF8=1"
chcp 65001 >nul
cmd /d /s /c ""%~f0" %*" & exit /b

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

REM  `!y 재시작` 으로 일부러 끈 것. 연속 실패로 세면 다섯 번 만에 실행기가 멈춘다.
if "%CODE%"=="26" (
    echo.
    echo  [*] 재시작 요청을 받았습니다.
    set TRIES=0
    goto bot_run
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
REM  받겠다고 하면 이 창에서 그대로 받아 풀고 덮어쓴다 — 새 창을 띄우지 않는다.
REM ---------------------------------------------------------------

:check_update
if defined YDGRB_UPDATED (
    REM  방금 업데이트하고 다시 켜진 참이다. 또 물어볼 이유가 없다.
    goto :eof
)

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

REM  지금 버전 이후로 바뀐 것을 전부 편다.
REM
REM  「새 버전이 있습니다」 만으로는 받을지 말지를 정할 수가 없다. 릴리스 설명은
REM  커밋 메시지로 만들어지므로(scripts/release-notes.mjs), 그 제목 줄만 골라
REM  버전마다 늘어놓는다. 본문(> 로 시작하는 줄)은 뺀다 — 창을 덮는다.
REM
REM  출력은 파워셸이 직접 한다. for /f 로 받아 echo 하면 제목에 든 괄호나 &, ^>
REM  가 cmd 에게 먹혀 줄이 깨진다.
REM
REM  받아 온 것을 **변수에 먼저 담는다.** Invoke-RestMethod 는 JSON 배열을 파이프에
REM  하나로 통째로 흘려서, 곧바로 Where-Object 에 물리면 $_ 이 배열 전체가 된다
REM  (-not $_.draft 가 배열에 걸려 전부 걸러진다). 담고 나서 거르면 하나씩 돈다.
REM
REM  지금 버전이 목록에 없으면(태그를 지웠거나 100개를 넘게 밀렸으면) 최신 것 하나만
REM  보여 준다. 전부 쏟아 내면 그게 더 못 읽는다.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; try { $raw = Invoke-RestMethod 'https://api.github.com/repos/%REPO%/releases?per_page=100' -Headers @{'User-Agent'='ydgrb'} -TimeoutSec 5; $all = @($raw | Where-Object { $_.tag_name -and -not $_.draft -and -not $_.prerelease }); if ($all.Count -eq 0) { exit }; $tags = @($all | ForEach-Object { $_.tag_name }); $i = [Array]::IndexOf($tags, '%CURRENT%'); if ($i -eq 0) { exit }; if ($i -gt 0) { $show = @($all | Select-Object -First $i) } else { $show = @($all | Select-Object -First 1) }; foreach ($r in $show) { Write-Host ''; Write-Host ('  YDGRB' + $r.tag_name); foreach ($line in (($r.body + '') -split '\r?\n')) { if ($line -match '^##\s*(.+)$') { Write-Host ('    [' + $matches[1].Trim() + ']') } elseif ($line -match '^-\s*(.+)$') { Write-Host ('      - ' + $matches[1].Trim().Trim([char]96)) } } } } catch { exit }"
echo.
set "ANSWER="
set /p "ANSWER=  지금 업데이트할까요? (Y/N): "
if /i not "%ANSWER%"=="Y" (
    echo  [*] 건너뜁니다.
    goto :eof
)

:do_update
set "ZIP=%TEMP%\YDGRB%LATEST%.zip"
set "UNPACK=%TEMP%\ydgrb-update"

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

REM  지금 실행 중이라 덮어쓸 수 없는 파일은 run.bat **하나뿐**이다.
REM  그것만 빼 두면 나머지는 이 창에서 지금 그대로 옮길 수 있다.
if exist "%UNPACK%\run.bat" move /y "%UNPACK%\run.bat" "%UNPACK%\run.bat.new" >nul

echo  [*] 적용하는 중...
xcopy /e /i /y "%UNPACK%\*" "%CD%\" >nul
if errorlevel 1 (
    echo  [X] 파일을 옮기지 못했습니다. 그냥 진행합니다.
    goto :eof
)

REM  VERSION 은 zip 에 든 것을 덮어쓰고 나서 방금 받은 태그로 다시 적는다 —
REM  zip 에 VERSION 이 빠져 있어도 버전이 어긋나 매번 다시 묻는 일이 없도록.
<nul set /p "=%LATEST%">"%CD%\VERSION"

REM  새 버전에서 의존성이 늘었을 수 있다. 다시 켜질 때 npm ci 를 돌리라는 표식.
> "%CD%\.update-applied" echo 1

rd /s /q "%UNPACK%" 2>nul
del /q "%ZIP%" 2>nul

echo  [*] 다시 시작합니다.
echo.
set "YDGRB_UPDATED=1"

REM ---------------------------------------------------------------
REM  아래 한 줄이 핵심이다. 셋을 한 줄에 몰아넣었다 —
REM    ① run.bat 을 새것으로 바꾸고  ② 그것을 이 창에서 실행하고  ③ 끝낸다.
REM
REM  cmd 는 배치를 줄 단위로 읽어 들인 뒤 실행한다. 이 줄을 읽은 다음에는
REM  run.bat 이 바뀌어도 뒤따르는 명령이 흔들리지 않는다. 줄을 나누면
REM  바뀐 파일을 옛 위치부터 다시 읽어 엉뚱한 것을 실행하게 된다.
REM
REM  `start` 를 쓰지 않으므로 새 창이 뜨지 않는다 — 이 창에서 그대로 이어진다.
REM
REM  exit /b 가 아니라 exit 인 이유: 여기는 call :check_update 로 불려 온
REM  서브루틴 안이라, exit /b 는 :menu 로 돌아가 버린다. 그러면 이미 바뀐
REM  run.bat 을 옛 위치부터 읽게 된다. 이 프로세스는 여기서 끝나야 한다.
REM ---------------------------------------------------------------
if exist "%CD%\run.bat.new" move /y "%CD%\run.bat.new" "%~f0" >nul & cmd /d /s /c ""%~f0" %*" & exit
