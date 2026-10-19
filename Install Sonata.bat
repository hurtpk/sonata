@echo off
setlocal EnableExtensions
title Sonata installer
cd /d "%~dp0"

rem  Sonata installer.
rem  Put this file inside the "sonata" folder (next to index.tsx) and double-click it.
rem  It installs Git, Node.js and pnpm if they're missing, downloads Equicord,
rem  copies Sonata into it, builds it and installs it into Discord.
rem  Run it again any time to update Sonata from a newer "sonata" folder.

echo.
echo  ==============================================================
echo                          SONATA INSTALLER
echo  ==============================================================
echo.
echo   This will:
echo     1. Install Git, Node.js and pnpm, only if you don't have them
echo     2. Download Equicord into your Documents folder
echo     3. Add Sonata to it, build it, and install it into Discord
echo.
echo   It takes about 5-10 minutes the first time.
echo.
echo   Heads-up: client mods like Equicord are against Discord's
echo   Terms of Service. People rarely get in trouble, but it's your call.
echo.
choice /c YN /n /m "  Continue? [Y/N] "
if errorlevel 2 goto :cancelled

rem ---- Where Sonata is: the folder this file is in ----
set "SONATA=%~dp0"
if "%SONATA:~-1%"=="\" set "SONATA=%SONATA:~0,-1%"
if not exist "%SONATA%\index.tsx" goto :nosonata

rem ---- winget, to install anything missing ----
where winget >nul 2>nul
if errorlevel 1 goto :nowinget

rem ---- Git ----
call :step "Checking for Git"
where git >nul 2>nul
if not errorlevel 1 goto :hasgit
echo   Git isn't installed - installing it now...
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
set "PATH=%PATH%;%ProgramFiles%\Git\cmd"
where git >nul 2>nul
if errorlevel 1 goto :restartneeded
:hasgit
echo   Git: OK

rem ---- Node.js 22 or newer ----
call :step "Checking for Node.js"
where node >nul 2>nul
if not errorlevel 1 goto :hasnode
echo   Node.js isn't installed - installing it now...
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm"
where node >nul 2>nul
if errorlevel 1 goto :restartneeded
:hasnode
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODEV=%%v"
set "NODEV=%NODEV:v=%"
if %NODEV% LSS 22 goto :oldnode
echo   Node.js: OK

rem ---- pnpm ----
call :step "Checking for pnpm"
set "PATH=%PATH%;%APPDATA%\npm"
where pnpm >nul 2>nul
if not errorlevel 1 goto :haspnpm
echo   pnpm isn't installed - installing it now...
call npm install -g pnpm
where pnpm >nul 2>nul
if errorlevel 1 goto :restartneeded
:haspnpm
echo   pnpm: OK

rem ---- Where Equicord goes ----
rem  An Equicord that's already there is used as it is. A new one goes in
rem  Documents\Equicord - unless Documents is synced by OneDrive (OneDrive would
rem  try to upload thousands of build files), then in your user folder instead.
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "DOCS=%%d"
if not defined DOCS set "DOCS=%USERPROFILE%\Documents"
set "EQ="
if exist "%USERPROFILE%\Documents\Equicord\package.json" set "EQ=%USERPROFILE%\Documents\Equicord"
if not defined EQ if exist "%DOCS%\Equicord\package.json" set "EQ=%DOCS%\Equicord"
if not defined EQ if exist "%USERPROFILE%\Equicord\package.json" set "EQ=%USERPROFILE%\Equicord"
if not defined EQ (
    echo "%DOCS%" | find /i "OneDrive" >nul && set "EQ=%USERPROFILE%\Equicord" || set "EQ=%DOCS%\Equicord"
)

call :step "Getting Equicord"
if exist "%EQ%\package.json" (
    echo   Found Equicord already in "%EQ%" - using that.
) else (
    echo   Downloading Equicord into "%EQ%"...
    git clone https://github.com/Equicord/Equicord "%EQ%"
    if errorlevel 1 goto :failed
)

rem ---- Copy Sonata in (skipped if this already IS that folder) ----
call :step "Adding Sonata"
set "TARGET=%EQ%\src\userplugins\sonata"
if /i "%SONATA%"=="%TARGET%" (
    echo   Sonata is already in place.
) else (
    if not exist "%EQ%\src\userplugins" mkdir "%EQ%\src\userplugins"
    robocopy "%SONATA%" "%TARGET%" /E /NFL /NDL /NJH /NJS /NP /XD node_modules .git >nul
    if errorlevel 8 goto :failed
    echo   Copied Sonata into "%TARGET%".
)

rem ---- Build and install ----
cd /d "%EQ%"
call :step "Installing Equicord's parts (this is the slow bit)"
call pnpm install
if errorlevel 1 goto :failed

call :step "Building Equicord and Sonata"
call pnpm build
if errorlevel 1 goto :failed

call :step "Installing into Discord"
echo   In the next screen, pick your Discord (usually "Stable") and press Enter.
echo.
call pnpm inject
if errorlevel 1 goto :failed

rem ---- Optional: yt-dlp for Media Downloader ----
call :step "Optional extra"
echo   Sonata's Media Downloader saves videos and music from YouTube,
echo   SoundCloud, TikTok and more. It needs a free program called yt-dlp.
echo.
where yt-dlp >nul 2>nul
if not errorlevel 1 (
    echo   yt-dlp is already installed.
    goto :done
)
choice /c YN /n /m "  Install yt-dlp now? [Y/N] "
if errorlevel 2 goto :done
winget install --id yt-dlp.yt-dlp -e --source winget --accept-package-agreements --accept-source-agreements

:done
echo.
echo  ==============================================================
echo                        SONATA IS INSTALLED
echo  ==============================================================
echo.
echo   Now FULLY close Discord: right-click its icon by the clock
echo   (bottom-right of your screen) and choose "Quit Discord".
echo   Then open Discord again.
echo.
echo   Open Sonata with the music-note button under your profile picture.
echo   A short welcome tour helps you pick your features.
echo.
echo   To update later: put the new "sonata" folder somewhere, put this
echo   file inside it, and double-click it again.
echo.
pause
exit /b 0

rem ---------------------------------------------------------------
:step
echo.
echo  --- %~1 ---
exit /b 0

:cancelled
echo.
echo   Nothing was changed.
pause
exit /b 0

:nosonata
echo.
echo   Couldn't find Sonata's files next to this installer.
echo   Put "Install Sonata.bat" inside the "sonata" folder - next to index.tsx -
echo   and run it from there.
pause
exit /b 1

:nowinget
echo.
echo   This needs "winget" ^(App Installer^), which comes with Windows 10 and 11.
echo   Get "App Installer" from the Microsoft Store, then run this again.
echo   Or follow INSTALL.txt to install everything by hand.
pause
exit /b 1

:oldnode
echo.
echo   Your Node.js is version %NODEV%, but Equicord needs 22 or newer.
echo   Update it with:  winget upgrade OpenJS.NodeJS.LTS
echo   Then run this again.
pause
exit /b 1

:restartneeded
echo.
echo   It's installed, but Windows needs a fresh window to find it.
echo   Close this window and double-click "Install Sonata.bat" again -
echo   it will carry on from where it stopped.
pause
exit /b 1

:failed
echo.
echo   Something went wrong in the step above - see the messages just before this.
echo   Running this again often fixes it. If not, follow INSTALL.txt by hand,
echo   or send a screenshot of this window to whoever gave you Sonata.
pause
exit /b 1
