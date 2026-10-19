# Sonata

Sonata adds around a hundred features to Discord: a GIF editor, a screenshot styler, a Spotify player, a message logger, stereo audio, performance settings and much more. It all lives in one page, with one look.

It's a plugin for **Equicord**, a Discord mod. This guide installs both. It takes about 10 minutes the first time.

**Quickest way:** download **[Install Sonata.bat](https://github.com/hurtpk/sonata/raw/main/Install%20Sonata.bat)** and double-click it. It's the only file you need: it does every step below for you, and running it again later updates Sonata. If Windows says "Windows protected your PC", click **More info → Run anyway**. **`INSTALL.txt`** has the same steps in plain text.

> **Heads-up:** client mods like Equicord are against Discord's Terms of Service. People rarely get in trouble for using one, but it's your call.

---

## 1. Install what you need (one time)

You need three free programs. Keep the default options in each installer.

1. **Git**: <https://git-scm.com/download/win>
2. **Node.js** (the LTS version, 22 or newer): <https://nodejs.org>
3. **pnpm**: open **PowerShell** and run:

   ```powershell
   npm install -g pnpm
   ```

## 2. Download Equicord

In PowerShell, go to where you want it (Documents works) and download it:

```powershell
cd ~\Documents
git clone https://github.com/Equicord/Equicord
cd Equicord
pnpm install
```

## 3. Add Sonata

Still in the `Equicord` folder, download Sonata into its plugin folder:

```powershell
git clone https://github.com/hurtpk/sonata src\userplugins\sonata
```

(Or use **Code → Download ZIP** on [the GitHub page](https://github.com/hurtpk/sonata), unzip it, and put it in `Documents\Equicord\src\userplugins\` as a folder named `sonata`.)

You should end up with `Documents\Equicord\src\userplugins\sonata\index.tsx`.

## 4. Build and install

Still in the `Equicord` folder in PowerShell:

```powershell
pnpm build
pnpm inject
```

`pnpm inject` asks which Discord to install into. Pick yours (usually **Stable**). Then fully close Discord (right-click its tray icon → **Quit Discord**) and open it again.

## 5. First start

- Sonata is on automatically. Open it with the **♫ button** in the dock under your profile picture.
- A short **welcome tour** helps you pick a starting set of features:
  - **Minimal**: a dozen everyday helpers.
  - **Balanced** (recommended): most of Sonata.
  - **Everything**: every feature, including the experimental ones.
- After the starting set, you pick a colour.
- You can change all of it later, and **Sonata Insights** helps if something isn't working.

---

## Updating

Double-click **`Install Sonata.bat`** again: it downloads the newest Sonata and rebuilds. Then press **Ctrl+R** in Discord.

Or by hand, in the `Equicord` folder:

```powershell
git -C src\userplugins\sonata pull
pnpm build
```

Then press **Ctrl+R** in Discord.

**What's new** opens by itself to show what changed.

To update Equicord itself, run `git pull`, then `pnpm install`, then `pnpm build`.

## Sharing your look and setup

Your settings aren't stored in this folder, so sharing the folder only shares Sonata itself. To share your setup too (which features are on, your design and colours), use **Share My Setup** in Sonata. Friends with Sonata can apply it with one click.

## Uninstalling

In the `Equicord` folder, run:

```powershell
pnpm uninject
```

Then restart Discord.

## Something wrong?

| What you see | What to do |
|---|---|
| `pnpm` is not recognised | Close and reopen PowerShell after installing Node.js and pnpm. |
| Discord opens without Equicord | Run `pnpm inject` again. Discord updates sometimes remove it. |
| A feature stopped working after a Discord update | Open **Sonata Insights**. It shows what broke and how to fix it. |
| Discord feels slow | In Sonata, open the **Performance** tab and pick **⚡ Light**. |
