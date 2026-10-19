@echo off
setlocal EnableExtensions
title Sonata installer
cd /d "%~dp0"

rem  Sonata installer and updater.
rem  Not installed yet: installs Git, Node.js and pnpm if they're missing,
rem  downloads Equicord and Sonata, builds them and installs them into Discord.
rem  Already installed: checks GitHub for a newer Sonata, shows what changed,
rem  and updates it if you say yes - or repairs it (rebuild and reconnect).
rem  Inside a "sonata" folder (next to index.tsx), it uses that folder's copy.

set "REPO=https://github.com/hurtpk/sonata"

rem ---- Is this file inside a Sonata folder? Then that copy is used. ----
set "SONATA=%~dp0"
if "%SONATA:~-1%"=="\" set "SONATA=%SONATA:~0,-1%"
set "LOCAL=0"
if exist "%SONATA%\index.tsx" if exist "%SONATA%\features" set "LOCAL=1"

rem ---- Where Equicord is (or goes) ----
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
set "TARGET=%EQ%\src\userplugins\sonata"
set "PATH=%PATH%;%ProgramFiles%\Git\cmd;%ProgramFiles%\nodejs;%APPDATA%\npm"

rem ---- Already installed? Then just check for updates. ----
if exist "%TARGET%\index.tsx" if exist "%EQ%\package.json" goto :updatemode

rem ================================================================
rem   INSTALLING
rem ================================================================

echo.
echo  ==============================================================
echo                          SONATA INSTALLER
echo  ==============================================================
echo.
echo   This will:
echo     1. Install Git, Node.js and pnpm, only if you don't have them
echo     2. Download Equicord into your Documents folder
echo     3. Download Sonata, build it, and install it into Discord
echo.
echo   It takes about 5-10 minutes. Once it's installed, running this
echo   again just checks for updates.
echo.
echo   Heads-up: client mods like Equicord are against Discord's
echo   Terms of Service. People rarely get in trouble, but it's your call.
echo.
choice /c YN /n /m "  Continue? [Y/N] "
if errorlevel 2 goto :cancelled

rem ---- winget, to install anything missing ----
where winget >nul 2>nul
if errorlevel 1 goto :nowinget

rem ---- Git ----
call :step "Checking for Git"
where git >nul 2>nul
if not errorlevel 1 goto :hasgit
echo   Git isn't installed - installing it now...
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
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
where node >nul 2>nul
if errorlevel 1 goto :restartneeded
:hasnode
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODEV=%%v"
set "NODEV=%NODEV:v=%"
if %NODEV% LSS 22 goto :oldnode
echo   Node.js: OK

rem ---- pnpm ----
call :step "Checking for pnpm"
where pnpm >nul 2>nul
if not errorlevel 1 goto :haspnpm
echo   pnpm isn't installed - installing it now...
call npm install -g pnpm
where pnpm >nul 2>nul
if errorlevel 1 goto :restartneeded
:haspnpm
echo   pnpm: OK

call :step "Getting Equicord"
if exist "%EQ%\package.json" (
    echo   Found Equicord already in "%EQ%" - using that.
) else (
    echo   Downloading Equicord into "%EQ%"...
    git clone https://github.com/Equicord/Equicord "%EQ%"
    if errorlevel 1 goto :failed
    rem  Marks it as this installer's own, so it can keep it on Sonata's version without asking.
    echo.>"%EQ%\.git\sonata-installed"
)

rem ---- Sonata: this folder's copy, or the newest one from GitHub ----
call :step "Getting Sonata"
if not exist "%EQ%\src\userplugins" mkdir "%EQ%\src\userplugins"
if "%LOCAL%"=="1" call :copylocal
if "%LOCAL%"=="1" if errorlevel 1 goto :failed
if "%LOCAL%"=="1" goto :build
echo   Downloading Sonata from GitHub...
git clone %REPO% "%TARGET%"
if errorlevel 1 goto :failed

:build
call :matchequicord
cd /d "%EQ%"
call :step "Installing Equicord's parts (this is the slow bit)"
call pnpm install
if errorlevel 1 goto :failed
call :sonataparts
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
    goto :installed
)
choice /c YN /n /m "  Install yt-dlp now? [Y/N] "
if errorlevel 2 goto :installed
winget install --id yt-dlp.yt-dlp -e --source winget --accept-package-agreements --accept-source-agreements

:installed
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
echo   To check for updates later, just double-click this file again.
echo.
pause
exit /b 0

rem ================================================================
rem   ALREADY INSTALLED: CHECKING FOR UPDATES
rem ================================================================

:updatemode
echo.
echo  ==============================================================
echo                          SONATA UPDATER
echo  ==============================================================
echo.
echo   Sonata is already installed in:
echo     %TARGET%
echo.
where git >nul 2>nul
if errorlevel 1 goto :nogit
where pnpm >nul 2>nul
if errorlevel 1 goto :nopnpm
call :versionof "%TARGET%" CUR

rem  This installer sits in a different "sonata" folder: offer that copy.
if "%LOCAL%"=="1" if /i not "%SONATA%"=="%TARGET%" goto :offerlocal

rem  Copied in by hand (from a zip), so there's no way to ask GitHub.
if not exist "%TARGET%\.git" goto :offergithub

echo   Checking GitHub for a newer version...
git -C "%TARGET%" fetch --quiet origin
if errorlevel 1 goto :offline
set "BEHIND=0"
for /f %%n in ('git -C "%TARGET%" rev-list --count HEAD..@{u} 2^>nul') do set "BEHIND=%%n"
if "%BEHIND%"=="0" goto :uptodate

call :remoteversion NEW
echo.
if "%CUR%"=="%NEW%" goto :samever
echo   A new version of Sonata is out!
echo     You have:  %CUR%
echo     Newest:    %NEW%
goto :changes
:samever
echo   An update for Sonata %CUR% is out!
:changes
echo.
echo   What changed:
git -C "%TARGET%" log --format="     - %%s" -n 12 HEAD..@{u}
echo.
choice /c YN /n /m "  Update now? [Y/N] "
if errorlevel 2 goto :noupdate
call :step "Updating Sonata"
git -C "%TARGET%" pull --ff-only
if errorlevel 1 goto :pullfailed
call :rebuild
if errorlevel 1 goto :failed
echo.
echo  ==============================================================
echo                        SONATA IS UPDATED
echo  ==============================================================
echo.
echo   Fully close Discord ^(right-click its tray icon, "Quit Discord"^)
echo   and open it again. "What's new" shows you everything that changed.
echo.
pause
exit /b 0

:uptodate
echo.
echo   You're up to date - Sonata %CUR% is the newest version.
echo.
echo   If Sonata went missing from Discord ^(a Discord update can do that^),
echo   Repair rebuilds it and connects it to Discord again.
echo.
choice /c QR /n /m "  [Q] Close   [R] Repair "
if errorlevel 2 goto :repair
exit /b 0

:offline
echo.
echo   Couldn't reach GitHub to check for updates - are you online?
echo   You have Sonata %CUR%.
echo.
choice /c QR /n /m "  [Q] Close   [R] Repair (rebuild and reconnect to Discord) "
if errorlevel 2 goto :repair
exit /b 0

:offerlocal
echo   This installer is inside another "sonata" folder:
echo     %SONATA%
echo   You have Sonata %CUR% installed.
echo.
choice /c YN /n /m "  Replace the installed Sonata with this folder's copy? [Y/N] "
if errorlevel 2 goto :noupdate
call :step "Copying Sonata in"
call :copylocal
if errorlevel 1 goto :failed
call :rebuild
if errorlevel 1 goto :failed
echo.
echo   Done - fully close Discord and open it again.
pause
exit /b 0

:offergithub
echo   This Sonata ^(%CUR%^) was copied in by hand, so it can't check for
echo   updates. Switching to the GitHub version gets you the newest Sonata
echo   now, and update checks from then on. Your current copy is kept
echo   as a backup.
echo.
choice /c YNR /n /m "  [Y] Switch to the GitHub version   [N] Close   [R] Repair only "
if errorlevel 3 goto :repair
if errorlevel 2 goto :noupdate
call :step "Switching to the GitHub version"
set "OLD=%EQ%\sonata-old-%RANDOM%"
echo   Moving your current Sonata to "%OLD%"...
move "%TARGET%" "%OLD%" >nul
if errorlevel 1 goto :failed
git clone %REPO% "%TARGET%"
if errorlevel 1 goto :failed
call :rebuild
if errorlevel 1 goto :failed
echo.
echo   Done - fully close Discord and open it again.
pause
exit /b 0

:repair
call :step "Repairing"
call :rebuild
if errorlevel 1 goto :failed
call :step "Connecting to Discord"
echo   In the next screen, pick your Discord (usually "Stable") and press Enter.
echo.
cd /d "%EQ%"
call pnpm inject
if errorlevel 1 goto :failed
echo.
echo   Repaired - fully close Discord and open it again.
pause
exit /b 0

:noupdate
echo.
echo   Nothing was changed.
pause
exit /b 0

rem ================================================================
rem   HELPERS
rem ================================================================

:step
echo.
echo  --- %~1 ---
exit /b 0

rem  Copies this folder's Sonata over the installed one (never touching .git or
rem  Claude's settings).
:copylocal
if /i "%SONATA%"=="%TARGET%" (
    echo   Using the Sonata that's already in place.
    exit /b 0
)
robocopy "%SONATA%" "%TARGET%" /E /NFL /NDL /NJH /NJS /NP /XD node_modules .git .claude >nul
if errorlevel 8 exit /b 1
echo   Copied Sonata from this folder into "%TARGET%".
exit /b 0

rem  Rebuilds Equicord with Sonata (installing Equicord's parts first if they're
rem  missing or Equicord just changed version).
:rebuild
set "EQCHANGED=0"
call :matchequicord
cd /d "%EQ%"
if not exist "%EQ%\node_modules" set "EQCHANGED=1"
if "%EQCHANGED%"=="1" (
    call :step "Installing Equicord's parts"
    call pnpm install
    if errorlevel 1 exit /b 1
)
call :sonataparts
if errorlevel 1 exit /b 1
call :step "Building"
call pnpm build
exit /b %errorlevel%

rem  Sonata's own extra parts (listed in its package.json) go in its own folder,
rem  so Equicord's files stay untouched.
:sonataparts
if not exist "%TARGET%\package.json" exit /b 0
call :step "Installing Sonata's parts"
call pnpm install --dir "%TARGET%" --ignore-workspace --lockfile=false --prod --no-optional
exit /b %errorlevel%

rem  Sonata is made for one Equicord version (equicord-version.txt), plus a few
rem  small fixes (equicord-fixes.patch). Newer Equicords sometimes change things
rem  Sonata uses, so this puts Equicord on that version: without asking if this
rem  installer downloaded that Equicord, otherwise only if you say yes.
:matchequicord
set "PIN="
if exist "%TARGET%\equicord-version.txt" for /f "usebackq eol=# tokens=1" %%h in ("%TARGET%\equicord-version.txt") do set "PIN=%%h"
if not defined PIN exit /b 0
if not exist "%EQ%\.git" exit /b 0
set "EQHEAD="
for /f %%h in ('git -C "%EQ%" rev-parse HEAD 2^>nul') do set "EQHEAD=%%h"
if /i "%EQHEAD%"=="%PIN%" goto :fixequicord
if exist "%EQ%\.git\sonata-installed" goto :switchequicord
echo.
echo   Sonata is made for a particular version of Equicord, and yours is
echo   a different one - so some of Sonata may not build or work right.
echo   Switching Equicord to Sonata's version fixes that. ^(Say no if you
echo   change Equicord's own files yourself.^)
echo.
choice /c YN /n /m "  Switch Equicord to Sonata's version? [Y/N] "
if errorlevel 2 exit /b 0
:switchequicord
call :step "Matching Equicord to Sonata"
git -C "%EQ%" checkout --quiet -B sonata %PIN% 2>nul
if not errorlevel 1 goto :switched
git -C "%EQ%" fetch --quiet origin
git -C "%EQ%" checkout --quiet -B sonata %PIN%
if errorlevel 1 (
    echo   Couldn't switch Equicord ^(it may have changes of its own^) - carrying on.
    exit /b 0
)
:switched
echo   Equicord is on Sonata's version.
set "EQCHANGED=1"
:fixequicord
if not exist "%TARGET%\equicord-fixes.patch" exit /b 0
git -C "%EQ%" apply --reverse --check "%TARGET%\equicord-fixes.patch" >nul 2>nul
if not errorlevel 1 exit /b 0
git -C "%EQ%" apply --whitespace=nowarn "%TARGET%\equicord-fixes.patch" >nul 2>nul
if errorlevel 1 (
    echo   Couldn't add Sonata's small Equicord fixes - carrying on without them.
    exit /b 0
)
echo   Added Sonata's small Equicord fixes.
exit /b 0

rem  Sonata's version, from the top of its changelog: call :versionof "<sonata folder>" VAR
:versionof
set "%~2=unknown"
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "$m = Select-String -Path '%~1\sonata\changelog.ts' -Pattern 'version: .(\d{4}\.\d+\.\d+[a-z]*).' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($m) { $m.Matches[0].Groups[1].Value }"`) do set "%~2=%%v"
exit /b 0

rem  The newest version on GitHub (after a fetch): call :remoteversion VAR
:remoteversion
set "%~1=newer"
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "$t = git -C '%TARGET%' show '@{u}:sonata/changelog.ts' 2>$null; $m = $t | Select-String -Pattern 'version: .(\d{4}\.\d+\.\d+[a-z]*).' | Select-Object -First 1; if ($m) { $m.Matches[0].Groups[1].Value }"`) do set "%~1=%%v"
exit /b 0

:cancelled
echo.
echo   Nothing was changed.
pause
exit /b 0

:nowinget
echo.
echo   This needs "winget" ^(App Installer^), which comes with Windows 10 and 11.
echo   Get "App Installer" from the Microsoft Store, then run this again.
echo   Or follow INSTALL.txt to install everything by hand.
pause
exit /b 1

:nogit
echo   Git isn't installed, so this can't check for updates.
echo   Install it with:  winget install Git.Git   - then run this again.
pause
exit /b 1

:nopnpm
echo   pnpm isn't installed, so Sonata can't be rebuilt.
echo   Install it with:  npm install -g pnpm   - then run this again.
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

:pullfailed
echo.
echo   Couldn't update Sonata from GitHub. Usually this means files in
echo   "%TARGET%" were changed by hand.
echo   Move that folder somewhere else ^(outside "src\userplugins"^)
echo   and run this again to get a fresh copy.
pause
exit /b 1

:failed
echo.
echo   Something went wrong in the step above - see the messages just before this.
echo   Running this again often fixes it. If not, follow INSTALL.txt by hand,
echo   or send a screenshot of this window to whoever gave you Sonata.
pause
exit /b 1
