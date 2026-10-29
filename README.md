# Prism

> [!WARNING]
> **This app is vibe coded.** It was built mostly by chatting with an AI coding assistant, not written
> line by line by an experienced developer. It works, but expect rough edges and bugs.
> **Keep backups of your music:** the Export button on Home saves your whole library to files.

**Your own music, on every device.** Prism is a music player for the songs you already have.
There are no accounts, subscriptions or ads. Add your music files, build playlists, and take your whole
library from your PC to your phone over Wi-Fi.

It runs on **Windows**, **Linux** and **Android**, with the same app and features on each.

## Download

Get the latest version from the [Releases page](https://github.com/ForsakenBlank/Prism/releases/latest):

| Device  | File                       | How to install |
|---------|----------------------------|----------------|
| Windows | `Prism-windows-x64.zip`    | Unzip anywhere and run `Prism.exe`. |
| Linux   | `Prism-linux-x64.tar.gz`   | Extract it and run `Prism` (or run `install-linux.sh` from a source checkout to add it to your app launcher). |
| Android | `Prism-android.apk`        | Open the file on your phone and allow installing from that source. |

On Windows and Linux, **Settings → General → App updates** installs new versions for you.
On Android, install the new APK over the old one.

## What it does

**Your library**
- Add songs from files (drag and drop works on desktop). Titles, artists and covers are read from the files.
- Playlists with custom covers, pinning and sorting, plus Liked Songs, star ratings and search.
- Import songs from YouTube (desktop and Android).
- Trim songs, edit and crop covers, find duplicates, and undo deletes from Recently deleted.

**Listening**
- Crossfade, playback speed (with or without keeping the pitch), sound presets, a volume leveller and a sleep timer.
- Queue with drag and drop, shuffle, repeat, and an up-next reminder.
- A DJ mode with two decks.
- Lock-screen and notification controls on Android, plus Android Auto.
- On desktop: a mini player that stays on top, and a tray icon so the music keeps playing with the window closed.

**Stats**
- Play counts and listening time per song and artist, with a week / month / year / all-time chart.
- A "when you listen" clock, streaks, milestones, most-skipped songs, song of the day, and a yearly Wrapped.

**Make it yours**
- Built-in themes and a theme editor (colours, pictures, effects), with colours taken from the album art.
- A new bars app icon in four colours (Dark, Light, Mono, Spectrum): Settings → Appearance → App icon changes the
  icon on your home screen, taskbar and tray.

**Between devices**
- **Wi-Fi sync:** the PC hosts, and the phone connects with a 6-digit code. Only what changed since you last
  synced goes across: new songs and covers, likes, ratings, renames, settings, themes and listening time.
  Listening time adds up, so 10 minutes on the PC plus 5 on the phone shows 15 on both.
  You choose each change before it's applied.
- **Export / import:** back up everything to files, or move it to another device.

All of your music and data stays on your own devices.

## Building it yourself

You need [Node.js](https://nodejs.org) (22 or newer). For the Android app you also need Java 21 and the Android SDK
(Android Studio includes both).

```bash
git clone https://github.com/ForsakenBlank/Prism.git
cd Prism
npm install
```

| Command                 | What it does |
|-------------------------|--------------|
| `npm start`             | Run the desktop app from source. |
| `npm run build-linux`   | Build the Linux app into `dist/Prism-linux-x64`. |
| `npm run build-exe`     | Build the Windows app into `dist/Prism-win32-x64`. |
| `npm run build-apk`     | Build a debug APK (Linux/macOS). Use `build-apk-win` on Windows. |
| `npm run sync-android`  | Copy the web files into the Android project (then open it with `npm run open-android`). |

### Where the code lives

- `app.v2.js`, `index.html`, `style.css`, `sync.js`, `themes.js`, `dj.js`, `tags.js`: the app itself, shared
  by every platform. Edit these in the project root. Builds copy them into `www/` for you
  (`npm run copy-web`).
- `main.js`, `preload.js`: the desktop (Electron) side: windows, tray, file saving, Wi-Fi sync hosting, updates, YouTube downloads.
- `www/main.js`: the Android-only start-up script.
- `android/`: the Android project (Capacitor), including the native background-audio and sync code.

### Releases

Pushing a version tag builds all three apps on GitHub and publishes them as a release:

```bash
git tag v1.2.0
git push origin v1.2.0
```

APKs are signed with a key kept in the repo's Actions secrets. To set it up once, run
`scripts/setup-android-signing.sh`. Keep a backup of the key, because every update has to be signed with the same one.

> Your data folder is still called `spootify`. That was the app's name before it became Prism, and keeping the
> folder means existing libraries carry over.
