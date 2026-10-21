@echo off
setlocal EnableExtensions
title Sonata installer
cd /d "%~dp0"

rem  Sonata installer and updater.
rem  Not installed yet: installs Git, Node.js and pnpm if they're missing,
rem  downloads Equicord and Sonata, builds them and installs them into Discord.
rem  Already installed: checks GitHub for a newer Sonata, shows what changed,
rem  and updates it if you say yes - or repairs it (rebuild and reconnect),
rem  or uninstalls it ([U] on the menu, or run it with --uninstall).
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

rem ---- The uninstaller: [U] on the menu, or this file run with --uninstall ----
if /i "%~1"=="--uninstall" goto :uninstall
if /i "%~1"=="--uninstall-run" goto :uninstallnow

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

rem  Git and Node.js may already be installed but not on this window's PATH
rem  (installed a moment ago, or by another app): their usual folders count too.
call :knownpaths

rem ---- Git ----
call :step "Checking for Git"
where git >nul 2>nul
if not errorlevel 1 goto :hasgit
echo   Git isn't installed - installing it now...
call :installgit
call :knownpaths
where git >nul 2>nul
if errorlevel 1 goto :restartneeded
:hasgit
echo   Git: OK

rem ---- Node.js 22 or newer ----
call :step "Checking for Node.js"
where node >nul 2>nul
if not errorlevel 1 goto :hasnode
echo   Node.js isn't installed - installing it now...
call :installnode
call :knownpaths
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
call :knownpaths
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
call :checkconnected
if "%CONNECTED%"=="0" goto :notconnected
echo   Connected to: %DISCORDS%

rem ---- Optional: yt-dlp for Media Downloader ----
call :offerytdlp

:installed
echo.
echo  ==============================================================
echo                        SONATA IS INSTALLED
echo  ==============================================================
call :restartdiscord
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
choice /c YNU /n /m "  Update now? [Y/N]   [U] Uninstall instead "
if errorlevel 3 goto :uninstall
if errorlevel 2 goto :noupdate
call :step "Updating Sonata"
git -C "%TARGET%" pull --ff-only
if errorlevel 1 goto :pullfailed
call :rebuild
if errorlevel 1 goto :failed
call :ensureconnected
if errorlevel 1 goto :notconnected
call :offerytdlp
echo.
echo  ==============================================================
echo                        SONATA IS UPDATED
echo  ==============================================================
call :restartdiscord
echo.
echo   "What's new" in Sonata shows you everything that changed.
echo.
pause
exit /b 0

:uptodate
echo.
echo   You're up to date - Sonata %CUR% is the newest version.
echo.
call :checkconnected
if "%CONNECTED%"=="1" goto :uptodateok
echo   BUT Equicord isn't connected to your Discord right now, so
echo   Sonata won't show up. Press R to repair that.
echo.
call :showdiscords
echo.
choice /c QRU /n /m "  [Q] Close   [R] Repair   [U] Uninstall "
if errorlevel 3 goto :uninstall
if errorlevel 2 goto :repair
exit /b 0
:uptodateok
call :showdiscords
echo.
rem  Connected, but Discord hasn't loaded it yet: a completely fresh start does it.
if not exist "%APPDATA%\Equicord\settings\settings.json" (
    call :restartdiscord
    echo.
)
echo   If Sonata went missing from Discord ^(a Discord update can do that^),
echo   Repair rebuilds it and connects it to Discord again.
echo.
choice /c QRU /n /m "  [Q] Close   [R] Repair   [U] Uninstall "
if errorlevel 3 goto :uninstall
if errorlevel 2 goto :repair
exit /b 0

:offline
echo.
echo   Couldn't reach GitHub to check for updates - are you online?
echo   You have Sonata %CUR%.
echo.
choice /c QRU /n /m "  [Q] Close   [R] Repair (rebuild and reconnect to Discord)   [U] Uninstall "
if errorlevel 3 goto :uninstall
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
call :ensureconnected
if errorlevel 1 goto :notconnected
call :offerytdlp
echo.
echo   Done.
call :restartdiscord
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
call :ensureconnected
if errorlevel 1 goto :notconnected
call :offerytdlp
echo.
echo   Done.
call :restartdiscord
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
call :checkconnected
if "%CONNECTED%"=="0" goto :notconnected
echo.
echo   Repaired - connected to: %DISCORDS%
echo.
call :showdiscords
call :offerytdlp
call :restartdiscord
pause
exit /b 0

:noupdate
echo.
echo   Nothing was changed.
pause
exit /b 0

rem ================================================================
rem   UNINSTALLING
rem ================================================================

rem  This file may be inside the very folders it's about to delete, and Windows
rem  reads a .bat as it runs - so the uninstaller runs from a copy in TEMP.
:uninstall
copy /y "%~f0" "%TEMP%\Sonata uninstaller.bat" >nul
if errorlevel 1 goto :failed
cd /d "%TEMP%"
"%TEMP%\Sonata uninstaller.bat" --uninstall-run

:uninstallnow
cd /d "%TEMP%"
title Sonata uninstaller
echo.
echo  ==============================================================
echo                         SONATA UNINSTALLER
echo  ==============================================================
echo.
if not exist "%TARGET%\index.tsx" if not exist "%EQ%\package.json" (
    echo   Sonata isn't installed on this PC - there's nothing to remove.
    goto :uninstallend
)
echo   [S] Remove Sonata only. Equicord stays, with any other plugins.
echo   [E] Remove everything: Sonata and Equicord. Discord goes back to normal.
echo   [C] Cancel
echo.
choice /c SEC /n /m "  Pick one: "
if errorlevel 3 goto :uninstallcancel
if errorlevel 2 goto :uninstallall

rem ---- Sonata only: delete its folder and rebuild Equicord without it ----
if not exist "%TARGET%" (
    echo   Sonata's folder isn't there - nothing to remove.
    goto :uninstallend
)
echo.
echo   This deletes Sonata's folder:
echo     %TARGET%
echo   Sonata's saved things ^(notes, reminders, themes...^) are lost with it.
echo.
choice /c YN /n /m "  Remove Sonata? [Y/N] "
if errorlevel 2 goto :uninstallcancel
call :step "Removing Sonata"
call :deletefolder "%TARGET%"
if errorlevel 1 goto :removefailed
echo   Sonata is removed.
if not exist "%EQ%\package.json" goto :uninstalled
call :step "Rebuilding Equicord without Sonata"
cd /d "%EQ%"
call pnpm build
set "BUILDERR=%errorlevel%"
cd /d "%TEMP%"
if not "%BUILDERR%"=="0" goto :failed
call :checkconnected
call :freshdiscord
goto :uninstalled

rem ---- Everything: disconnect Equicord from Discord, then delete it ----
:uninstallall
echo.
echo   This disconnects Equicord from Discord, then deletes:
echo     %EQ%
if not exist "%EQ%\.git\sonata-installed" (
    echo.
    echo   Heads-up: this Equicord wasn't set up by the Sonata installer, so it
    echo   may have other plugins or changes of your own in it.
)
echo.
choice /c YN /n /m "  Remove everything? [Y/N] "
if errorlevel 2 goto :uninstallcancel
call :checkconnected
set "WASDISCORDS=%DISCORDS%"
if "%CONNECTED%"=="0" goto :disconnected
call :closediscord
:disconnectagain
call :step "Disconnecting Equicord from Discord"
echo   In the next screen, pick your Discord ^(usually "Stable"^) and press Enter.
echo.
cd /d "%EQ%"
call pnpm uninject
cd /d "%TEMP%"
call :checkconnected
if "%CONNECTED%"=="0" goto :disconnected
rem  Discord loads Equicord from its folder, so deleting it while still connected
rem  would stop Discord from starting. Never delete it until nothing uses it.
echo.
echo   Equicord is still connected to: %DISCORDS%
echo   ^(Pick that one in the next screen.^) Equicord isn't deleted until it's
echo   disconnected from every Discord.
choice /c RQ /n /m "  [R] Disconnect again   [Q] Stop here "
if errorlevel 2 goto :uninstallcancel
goto :disconnectagain
:disconnected
echo   Equicord is disconnected from Discord.
call :step "Deleting Equicord"
call :deletefolder "%EQ%"
if errorlevel 1 goto :removefailed
echo   Equicord and Sonata are deleted.
if not exist "%APPDATA%\Equicord" goto :startafter
echo.
echo   Equicord's saved settings are still in "%APPDATA%\Equicord".
choice /c YN /n /m "  Delete those too? [Y/N] "
if errorlevel 2 goto :startafter
call :deletefolder "%APPDATA%\Equicord"
if errorlevel 1 (echo   Couldn't delete them - you can delete that folder yourself.) else (echo   Settings deleted.)
:startafter
set "DISCORDS=%WASDISCORDS%"
call :startdiscord
goto :uninstalled

:uninstallcancel
echo.
echo   Nothing was removed.
goto :uninstallend

:removefailed
echo.
echo   Couldn't delete everything - a file may be in use. Close Discord, and
echo   anything open in that folder, then run this again.
goto :uninstallend

:uninstalled
echo.
echo  ==============================================================
echo                       SONATA IS UNINSTALLED
echo  ==============================================================
echo.
echo   Git, Node.js and pnpm were left installed, since other programs can
echo   use them. You can uninstall them from Windows Settings ^> Apps.
echo   You can delete this installer file now.
:uninstallend
echo.
pause
rem  Removes this copy from TEMP once it's finished (it only ever runs as that copy).
if /i not "%~1"=="--uninstall-run" exit /b 0
(goto) 2>nul & del "%~f0"

rem ================================================================
rem   HELPERS
rem ================================================================

rem  call :deletefolder "<folder>" - deletes a folder and everything in it. Falls
rem  back to PowerShell for the very long paths Equicord's parts can have.
:deletefolder
if not exist "%~1" exit /b 0
rmdir /s /q "%~1" 2>nul
if not exist "%~1" exit /b 0
set "DELDIR=%~1"
powershell -NoProfile -Command "Remove-Item -LiteralPath ('\\?\' + $env:DELDIR) -Recurse -Force -ErrorAction SilentlyContinue" 2>nul
if exist "%~1" exit /b 1
exit /b 0

rem  Closes every Discord.
:closediscord
echo   Closing Discord...
for %%n in (Discord DiscordPTB DiscordCanary DiscordDevelopment) do taskkill /f /t /im %%n.exe >nul 2>nul
timeout /t 3 /nobreak >nul
for %%n in (Discord DiscordPTB DiscordCanary DiscordDevelopment) do taskkill /f /t /im %%n.exe >nul 2>nul
exit /b 0

rem  Starts the Discords in DISCORDS (or just Discord) from their newest app-* folder.
:startdiscord
echo   Starting Discord...
powershell -NoProfile -Command "$names = @(($env:DISCORDS -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }); if (-not $names) { $names = @('Discord') }; foreach ($n in $names) { $a = Get-ChildItem (Join-Path $env:LOCALAPPDATA $n) -Directory -Filter 'app-*' -EA 0 | Sort-Object { try { [version]$_.Name.Substring(4) } catch { [version]'0.0' } } | Select-Object -Last 1; if ($a) { $exe = Join-Path $a.FullName ($n + '.exe'); if (Test-Path $exe) { Start-Process $exe -WorkingDirectory $a.FullName; '    Started ' + $n + ' (' + $a.Name + ')' } } }"
exit /b 0

rem  After removing Sonata: Discord has to start fresh to stop loading it.
:freshdiscord
echo.
echo   Discord has to start completely fresh to drop Sonata. This closes
echo   Discord ^(if it's open^) and starts it again.
choice /c YN /n /m "  Restart Discord now? [Y/N] "
if errorlevel 2 (
    echo   Then fully close Discord yourself: right-click its icon by the clock
    echo   ^(bottom-right^), choose "Quit Discord", and open it again.
    exit /b 0
)
call :closediscord
call :startdiscord
exit /b 0

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

rem  The folders Git, Node.js, pnpm and winget install to, added to this window's
rem  PATH if they exist, so a fresh install works without opening a new window.
:knownpaths
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%PATH%;%ProgramFiles%\Git\cmd"
if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Git\cmd"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%PATH%;%ProgramFiles%\nodejs"
if exist "%APPDATA%\npm\pnpm.cmd" set "PATH=%PATH%;%APPDATA%\npm"
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WindowsApps"
exit /b 0

rem  winget (Windows' app installer). It comes with Windows 10 and 11 but sometimes
rem  isn't set up for this account yet, so it asks Windows to set it up first.
:findwinget
where winget >nul 2>nul
if not errorlevel 1 exit /b 0
call :knownpaths
where winget >nul 2>nul
if not errorlevel 1 exit /b 0
echo   Setting up winget, Windows' app installer...
powershell -NoProfile -Command "try { Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe -ErrorAction Stop } catch { }" >nul 2>nul
call :knownpaths
where winget >nul 2>nul
exit /b %errorlevel%

rem  Git: through winget, or (without it) Git for Windows' own installer from its
rem  official GitHub page. Windows asks for permission while it installs.
:installgit
call :findwinget
if errorlevel 1 goto :installgitdirect
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
exit /b 0
:installgitdirect
echo   Downloading Git from its official page ^(github.com/git-for-windows^)...
echo   Windows will ask for permission to install it - press Yes.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {'arm64'} else {'64-bit'}; $r = Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent'='Sonata-installer' }; $a = $r.assets | Where-Object { $_.name -match ('^Git-[\d.]+-' + $arch + '\.exe$') } | Select-Object -First 1; $f = Join-Path $env:TEMP $a.name; Invoke-WebRequest $a.browser_download_url -OutFile $f -UseBasicParsing; Start-Process $f -ArgumentList '/VERYSILENT','/NORESTART','/SP-' -Wait; Remove-Item $f -ErrorAction SilentlyContinue"
exit /b 0

rem  Node.js: through winget, or (without it) the LTS installer from nodejs.org.
:installnode
call :findwinget
if errorlevel 1 goto :installnodedirect
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
exit /b 0
:installnodedirect
echo   Downloading Node.js from its official site ^(nodejs.org^)...
echo   Windows will ask for permission to install it - press Yes.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {'arm64'} else {'x64'}; $v = ((Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts } | Select-Object -First 1).version; $f = Join-Path $env:TEMP ('node-' + $v + '-' + $arch + '.msi'); Invoke-WebRequest ('https://nodejs.org/dist/' + $v + '/node-' + $v + '-' + $arch + '.msi') -OutFile $f -UseBasicParsing; Start-Process msiexec -ArgumentList ('/i ' + [char]34 + $f + [char]34 + ' /passive /norestart') -Wait -Verb RunAs; Remove-Item $f -ErrorAction SilentlyContinue"
exit /b 0

rem  yt-dlp (for Media Downloader): asks to install it if it isn't there, and
rem  says nothing if it is. winget puts it in WinGet\Links, which a window
rem  that was already open may not see yet, so that folder is checked too.
:offerytdlp
where yt-dlp >nul 2>nul
if not errorlevel 1 exit /b 0
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\yt-dlp.exe" exit /b 0
call :step "Optional extra"
echo   Sonata's Media Downloader saves videos and music from YouTube,
echo   SoundCloud, TikTok and more. It needs a free program called yt-dlp.
echo.
call :findwinget
if errorlevel 1 (
    echo   It can be installed later with:  winget install yt-dlp
    exit /b 0
)
choice /c YN /n /m "  Install yt-dlp now? [Y/N] "
if errorlevel 2 exit /b 0
winget install --id yt-dlp.yt-dlp -e --source winget --accept-package-agreements --accept-source-agreements
exit /b 0

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
call :trycheckout
if not errorlevel 1 goto :switched
rem  Changes in Equicord's own files stop the switch - usually from installing its
rem  parts (pnpm-lock.yaml) or an older set of Sonata's fixes. Put them aside with
rem  git stash (nothing is lost: "git stash pop" brings them back) and try again.
echo   Equicord has changes of its own - putting them aside ^(git stash^) to switch.
git -C "%EQ%" stash push --quiet -m "Sonata: Equicord changes put aside before switching versions" >nul 2>nul
call :trycheckout
if not errorlevel 1 goto :switched
echo.
echo   Couldn't switch Equicord to Sonata's version, so the build may fail.
echo   What git said:
git -C "%EQ%" checkout --quiet -B sonata %PIN%
echo.
exit /b 0
:switched
echo   Equicord is on Sonata's version.
set "EQCHANGED=1"
:fixequicord
if not exist "%TARGET%\equicord-fixes.patch" exit /b 0
git -C "%EQ%" apply --reverse --check "%TARGET%\equicord-fixes.patch" >nul 2>nul
if not errorlevel 1 exit /b 0
git -C "%EQ%" apply --whitespace=nowarn "%TARGET%\equicord-fixes.patch" >nul 2>nul
if not errorlevel 1 goto :fixesadded
rem  An older set of Sonata's fixes is in there: put those files back as they
rem  came, then add the new set.
for /f "tokens=3" %%f in ('findstr /b /c:"diff --git a/" "%TARGET%\equicord-fixes.patch"') do call :restorefile "%%f"
git -C "%EQ%" apply --whitespace=nowarn "%TARGET%\equicord-fixes.patch" >nul 2>nul
if errorlevel 1 (
    echo   Couldn't add Sonata's small Equicord fixes - carrying on without them.
    exit /b 0
)
:fixesadded
echo   Added Sonata's small Equicord fixes.
exit /b 0

rem  Puts Equicord on Sonata's version (fetching it first if it isn't downloaded yet).
:trycheckout
git -C "%EQ%" checkout --quiet -B sonata %PIN% 2>nul
if not errorlevel 1 exit /b 0
git -C "%EQ%" fetch --quiet origin
git -C "%EQ%" checkout --quiet -B sonata %PIN% 2>nul
exit /b %errorlevel%

rem  call :restorefile "a/<path>" - puts one Equicord file back as it came.
:restorefile
set "RF=%~1"
git -C "%EQ%" checkout --quiet HEAD -- "%RF:~2%" 2>nul
exit /b 0

rem  Is this Equicord connected to a Discord? Looks in the newest app-* folder of
rem  each Discord at resources\app.asar: Equicord's installer makes that a tiny
rem  file (newer installers) or folder (older ones) that loads Equicord from this
rem  folder. Sets CONNECTED (1/0) and DISCORDS (which ones).
:checkconnected
set "CONNECTED=0"
set "DISCORDS="
for /f "usebackq delims=" %%r in (`powershell -NoProfile -Command "$w = ($env:EQ + '\dist').Replace('\','\\').ToLower(); $hit = foreach ($n in 'Discord','DiscordPTB','DiscordCanary','DiscordDevelopment') { $a = Get-ChildItem (Join-Path $env:LOCALAPPDATA $n) -Directory -Filter 'app-*' -EA 0 | Sort-Object { try { [version]$_.Name.Substring(4) } catch { [version]'0.0' } } | Select-Object -Last 1; if ($a) { $f = Join-Path $a.FullName 'resources\app.asar'; if (Test-Path $f -PathType Container) { $f = Join-Path $f 'index.js' }; if ((Test-Path $f -PathType Leaf) -and (Get-Item $f).Length -lt 131072 -and [IO.File]::ReadAllText($f).ToLower().Contains($w)) { $n } } }; $hit -join ', '"`) do set "DISCORDS=%%r"
if defined DISCORDS set "CONNECTED=1"
exit /b 0

rem  Lists each Discord and what it loads - so a screenshot shows what's wrong.
:showdiscords
echo   What's on this PC:
powershell -NoProfile -Command "$any = $false; foreach ($n in 'Discord','DiscordPTB','DiscordCanary','DiscordDevelopment') { $a = Get-ChildItem (Join-Path $env:LOCALAPPDATA $n) -Directory -Filter 'app-*' -EA 0 | Sort-Object { try { [version]$_.Name.Substring(4) } catch { [version]'0.0' } } | Select-Object -Last 1; if (-not $a) { continue }; $any = $true; $f = Join-Path $a.FullName 'resources\app.asar'; if (Test-Path $f -PathType Container) { $f = Join-Path $f 'index.js' }; $t = ''; if ((Test-Path $f -PathType Leaf) -and (Get-Item $f).Length -lt 131072) { $t = [IO.File]::ReadAllText($f) }; $m = [regex]::Match($t, 'require\((.+?)\)'); if ($m.Success) { '    ' + $n + ' (' + $a.Name + '): loads Equicord from ' + $m.Groups[1].Value } else { '    ' + $n + ' (' + $a.Name + '): normal Discord, no Equicord' } }; if (-not $any) { '    No Discord found in ' + $env:LOCALAPPDATA }"
echo     This Equicord: %EQ%
if exist "%EQ%\dist\desktop\patcher.js" (echo     Built: yes) else (echo     Built: NO - Repair builds it)
powershell -NoProfile -Command "$s = Join-Path $env:APPDATA 'Equicord\settings\settings.json'; if (Test-Path $s) { '    Equicord has started inside Discord - last on ' + (Get-Item $s).LastWriteTime.ToString('d MMM, h:mm tt') } else { '    Equicord has NEVER started inside Discord on this PC' }; if (Get-AppxPackage -Name '*Discord*' -EA 0) { '    Found the Microsoft Store Discord - Equicord can''t mod that one. Use the one from discord.com.' }"
exit /b 0

rem  Connects Equicord to Discord if it isn't already. Fails if it still isn't.
:ensureconnected
call :checkconnected
if "%CONNECTED%"=="1" exit /b 0
call :step "Connecting to Discord"
echo   Equicord isn't connected to your Discord yet - doing that now.
echo   In the next screen, pick your Discord (usually "Stable") and press Enter.
echo.
cd /d "%EQ%"
call pnpm inject
call :checkconnected
if "%CONNECTED%"=="1" exit /b 0
exit /b 1

rem  Discord only loads Equicord on a completely fresh start. This closes every
rem  Discord process (including the hidden ones in the tray), then starts the
rem  connected Discord's own Discord.exe directly - not through Discord's
rem  updater, which can update first and start a copy without Equicord.
rem  Uses DISCORDS from :checkconnected (Discord if it's empty).
:restartdiscord
echo.
echo   Discord has to start completely fresh to load Sonata. This closes
echo   Discord ^(if it's open^) and starts it again.
choice /c YN /n /m "  Start Discord with Sonata now? [Y/N] "
if errorlevel 2 (
    echo   Then fully close Discord yourself: right-click its icon by the clock
    echo   ^(bottom-right^), choose "Quit Discord", and open it again.
    exit /b 0
)
echo   Closing Discord...
for %%n in (Discord DiscordPTB DiscordCanary DiscordDevelopment) do taskkill /f /t /im %%n.exe >nul 2>nul
timeout /t 3 /nobreak >nul
for %%n in (Discord DiscordPTB DiscordCanary DiscordDevelopment) do taskkill /f /t /im %%n.exe >nul 2>nul
echo   Starting Discord...
powershell -NoProfile -Command "$names = @(($env:DISCORDS -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }); if (-not $names) { $names = @('Discord') }; foreach ($n in $names) { $a = Get-ChildItem (Join-Path $env:LOCALAPPDATA $n) -Directory -Filter 'app-*' -EA 0 | Sort-Object { try { [version]$_.Name.Substring(4) } catch { [version]'0.0' } } | Select-Object -Last 1; if ($a) { $exe = Join-Path $a.FullName ($n + '.exe'); if (Test-Path $exe) { Start-Process $exe -WorkingDirectory $a.FullName; '    Started ' + $n + ' (' + $a.Name + ')' } } }"
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

:notconnected
echo.
echo   Sonata is built, but Equicord didn't connect to Discord.
echo.
call :showdiscords
echo.
echo   Usually one of these:
echo     - A different Discord was picked in that screen - try again and
echo       pick the Discord you use ^(usually "Stable"^).
echo     - Discord was in the middle of updating - open Discord, let it
echo       finish, then try again.
echo.
choice /c RQ /n /m "  [R] Try again   [Q] Close "
if errorlevel 2 exit /b 1
goto :repair

:failed
echo.
echo   Something went wrong in the step above - see the messages just before this.
echo   Running this again often fixes it. If not, follow INSTALL.txt by hand,
echo   or send a screenshot of this window to whoever gave you Sonata.
pause
exit /b 1
