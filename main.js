const { app, BrowserWindow, dialog, ipcMain, screen, powerSaveBlocker, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execFileSync } = require('child_process');

// Window size/position (and the theme's background colour, so a light theme doesn't
// flash dark on startup) are remembered in <userData>/window-state.json.
function stateFile() { return path.join(app.getPath('userData'), 'window-state.json'); }
function readWindowState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}; } catch { return {}; } }
function writeWindowState(patch) { try { fs.writeFileSync(stateFile(), JSON.stringify({ ...readWindowState(), ...patch })); } catch {} }
function isOnScreen(b) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return false;
  return screen.getAllDisplays().some(({ workArea: a }) => b.x + 80 < a.x + a.width && b.x + b.width - 80 > a.x && b.y >= a.y - 10 && b.y + 40 < a.y + a.height);
}

function createWindow() {
  const saved = readWindowState();
  const bounds = saved.bounds && isOnScreen(saved.bounds) ? saved.bounds : { width: 1200, height: 800 };
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 480,
    icon: path.join(__dirname, 'www', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false // keeps playback timing (crossfades, stats) exact while hidden in the tray
    },
    backgroundColor: /^#[0-9a-f]{6}$/i.test(saved.background || '') ? saved.background : '#121212'
  });
  if (saved.maximized) win.maximize();

  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  win.setMenuBarVisibility(false);

  const save = () => {
    if (win.isDestroyed()) return;
    const normal = !win.isMaximized() && !win.isMinimized() && !win.isFullScreen();
    writeWindowState({ maximized: win.isMaximized(), bounds: normal ? win.getBounds() : readWindowState().bounds });
  };
  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 600); };
  win.on('resize', saveSoon);
  win.on('move', saveSoon);
  win.on('close', save);
  // Closing goes to the tray (the music keeps playing); Quit is in the tray menu, or Ctrl+Q.
  win.on('close', (e) => { if (!quitting && tray) { e.preventDefault(); win.hide(); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.shift) return;
    const k = String(input.key).toLowerCase();
    if (k === 'q') { e.preventDefault(); quitting = true; app.quit(); }
    else if (k === 'w') { e.preventDefault(); hideToTray(); }
  });
  win.on('closed', () => { if (miniWin && !miniWin.isDestroyed()) miniWin.close(); });
  // The page crashed or was killed: note why (the page logs it on its next start) and load it again.
  win.webContents.on('render-process-gone', (event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    pendingCrash = { reason: details.reason === 'oom' ? 'memory' : details.reason, at: Date.now() };
    setTimeout(() => { if (!win.isDestroyed()) win.webContents.reload(); }, 300);
  });
  mainWin = win;
}

// ══════════════════════════════════════════════
// ── MINI PLAYER (desktop) ──
// A small always-on-top window (www/mini.html). It holds no player of its own: the
// main window sends it the track, play state, position and theme colours
// ('mini:state'), and it sends back button presses ('mini:command'), which are
// relayed to the main window. Its position is remembered in window-state.json.
// ══════════════════════════════════════════════
let mainWin = null, miniWin = null;
let pendingCrash = null; // why the main page last died, handed to it once (app:take-crash)
ipcMain.handle('app:take-crash', () => { const c = pendingCrash; pendingCrash = null; return c; });
function openMini() {
  if (miniWin && !miniWin.isDestroyed()) { miniWin.show(); miniWin.focus(); return; }
  const saved = readWindowState().mini;
  const size = { width: 380, height: 112 };
  const bounds = saved && isOnScreen({ ...saved, ...size }) ? { x: saved.x, y: saved.y, ...size } : size;
  miniWin = new BrowserWindow({
    ...bounds, frame: false, resizable: false, maximizable: false, fullscreenable: false, alwaysOnTop: true,
    title: 'Spootify mini player', icon: path.join(__dirname, 'www', 'icon.png'),
    backgroundColor: /^#[0-9a-f]{6}$/i.test(readWindowState().background || '') ? readWindowState().background : '#121212',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  miniWin.setAlwaysOnTop(true, 'floating');
  // Wayland (Hyprland etc.) ignores app-requested position and always-on-top; the
  // compositor decides. A window rule on the title above can float/pin it instead.
  miniWin.loadFile(path.join(__dirname, 'www', 'mini.html'));
  const remember = () => { if (miniWin && !miniWin.isDestroyed()) { const b = miniWin.getBounds(); writeWindowState({ mini: { x: b.x, y: b.y } }); } };
  miniWin.on('moved', remember);
  miniWin.on('close', remember);
  miniWin.on('closed', () => { miniWin = null; if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('mini:closed'); });
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('mini:opened');
}
ipcMain.on('mini:toggle', () => { if (miniWin && !miniWin.isDestroyed()) miniWin.close(); else openMini(); });
ipcMain.on('mini:state', (event, state) => { if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('mini:state', state); });
ipcMain.on('mini:command', (event, cmd) => {
  if (!cmd || typeof cmd.type !== 'string') return;
  if (cmd.type === 'close') { if (miniWin && !miniWin.isDestroyed()) miniWin.close(); return; }
  if (!mainWin || mainWin.isDestroyed()) return;
  if (cmd.type === 'show-main') { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); return; }
  mainWin.webContents.send('mini:command', cmd);
});

ipcMain.on('app:set-background', (event, color) => {
  if (!/^#[0-9a-f]{6}$/i.test(String(color || ''))) return;
  if (readWindowState().background !== color) writeWindowState({ background: color });
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.setBackgroundColor(color);
});

ipcMain.handle('save-file', async (event, data, defaultName) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath, data, 'utf-8');
  return true;
});

// Library export: the page picks a folder once, then streams each part file into it as
// text, so a library of several GB never has to sit in memory as one string. Files can
// only be created inside a folder the user picked in this session.
const exportDirs = new Set();
const exportFiles = new Map();
let exportSeq = 0;
ipcMain.handle('export:pick-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const r = await dialog.showOpenDialog(win, { title: 'Choose a folder for your library export', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  exportDirs.add(r.filePaths[0]);
  return r.filePaths[0];
});
ipcMain.handle('export:open', (event, dir, name) => {
  if (!exportDirs.has(dir)) throw new Error('Pick a folder first');
  const file = path.join(dir, path.basename(String(name || 'spootify-library.json')).replace(/[\\/:*?"<>|]/g, '_'));
  const id = ++exportSeq;
  exportFiles.set(id, { fd: fs.openSync(file, 'w'), file });
  return { id, path: file };
});
ipcMain.handle('export:write', (event, id, text) => {
  const f = exportFiles.get(id);
  if (!f) throw new Error('That file is closed');
  fs.writeSync(f.fd, String(text));
  return true;
});
ipcMain.handle('export:close', (event, id, discard) => {
  const f = exportFiles.get(id);
  if (!f) return null;
  exportFiles.delete(id);
  fs.closeSync(f.fd);
  if (discard) { try { fs.unlinkSync(f.file); } catch {} return null; }
  return f.file;
});

// ── WI-FI SYNC (host) ──
// While the Sync dialog has "Let a phone connect" on, a small HTTP server listens on the
// local network. Every request is one JSON POST to /sync carrying the 6-digit code shown
// on screen; the page (sync.js) does the actual work and its answer is sent back as JSON.
// Ten wrong codes lock the server until hosting is turned off and on again.
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const SYNC_PORT = Number(process.env.SPOOTIFY_SYNC_PORT) || 47823; // the env override lets a second copy host for testing
let syncServer = null, syncCode = null, syncFails = 0, syncWin = null, syncSeq = 0;
const syncPending = new Map();
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
  }
  return out;
}
function syncRespond(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(JSON.stringify(obj));
}
function handleSyncHttp(req, res) {
  if (req.method === 'OPTIONS') { syncRespond(res, 204, {}); return; }
  if (req.method !== 'POST' || req.url !== '/sync') { syncRespond(res, 404, { error: 'Not found' }); return; }
  const chunks = []; let size = 0, tooBig = false;
  req.on('data', (c) => { size += c.length; if (size > 32 * 1024 * 1024) { tooBig = true; req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    if (tooBig) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { syncRespond(res, 400, { error: 'Bad request' }); return; }
    if (syncFails >= 10) { syncRespond(res, 429, { error: 'Too many wrong codes. Turn hosting off and on again on the PC.' }); return; }
    if (!syncCode || String(body.code) !== syncCode) { syncFails++; syncRespond(res, 403, { error: 'Wrong code' }); return; }
    if (!syncWin || syncWin.isDestroyed()) { syncRespond(res, 503, { error: 'The PC app is closing' }); return; }
    delete body.code;
    const id = ++syncSeq;
    const timer = setTimeout(() => { if (syncPending.delete(id)) syncRespond(res, 504, { error: 'The PC took too long to answer' }); }, 5 * 60 * 1000);
    syncPending.set(id, (answer) => { clearTimeout(timer); syncRespond(res, answer && answer.error ? 500 : 200, answer || {}); });
    syncWin.webContents.send('sync:request', id, body);
  });
}
// While hosting, the PC must not go to sleep (that would cut the phone off mid-sync).
let syncSleepBlock = null;
function stopSyncHost() {
  syncCode = null;
  if (syncSleepBlock !== null) { try { powerSaveBlocker.stop(syncSleepBlock); } catch {} syncSleepBlock = null; }
  if (syncServer) { try { syncServer.close(); } catch {} syncServer = null; }
}
ipcMain.handle('sync:host', async (event, on) => {
  if (!on) { stopSyncHost(); return null; }
  syncWin = BrowserWindow.fromWebContents(event.sender);
  syncCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  if (syncSleepBlock === null) syncSleepBlock = powerSaveBlocker.start('prevent-app-suspension');
  syncFails = 0;
  if (!syncServer) {
    const server = http.createServer(handleSyncHttp);
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(SYNC_PORT, '0.0.0.0', resolve); }); }
    catch (e) { stopSyncHost(); throw e; }
    syncServer = server;
  }
  return { code: syncCode, port: SYNC_PORT, addresses: lanAddresses() };
});
ipcMain.on('sync:reply', (event, id, answer) => { const done = syncPending.get(id); if (done) { syncPending.delete(id); done(answer); } });

// ══════════════════════════════════════════════
// ── YT-DLP INTEGRATION (desktop) ──
// yt-dlp is fetched on first use into <userData>/bin. YouTube also needs a
// JavaScript runtime for its "n" challenge, so we look for deno/node (>= 20) on
// PATH and otherwise drop a deno binary next to yt-dlp, where it auto-discovers it.
// The Android build does the same job via youtubedl-android (see YtDlpPlugin.java);
// both expose the same status/setup/info/download/update surface to app.v2.js.
// ══════════════════════════════════════════════
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const YTDLP_NAME = IS_WIN ? 'yt-dlp.exe' : (process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp');
const DENO_NAME = IS_WIN ? 'deno.exe' : 'deno';
// On Linux the plain 'yt-dlp' asset is a zipapp that needs python3, so fetch the standalone build.
const YTDLP_ASSET = IS_LINUX ? (process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux') : YTDLP_NAME;
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + YTDLP_ASSET;
// Same field list the Android plugin prints, so the renderer sees one shape.
const INFO_TEMPLATE = '%(.{id,title,uploader,channel,artist,track,duration,thumbnail,webpage_url,extractor})j';
// One line per playlist entry with --flat-playlist (lists without downloading anything).
const PLAYLIST_TEMPLATE = '%(.{id,title,uploader,channel,duration,url,webpage_url,playlist_title,playlist_uploader,view_count,live_status})j';
// Audio-only progressive formats: no ffmpeg needed, and the <audio> element plays m4a/webm directly.
const AUDIO_FORMAT = 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best';
const AUDIO_EXTS = new Set(['m4a', 'webm', 'mp3', 'opus', 'ogg', 'mp4', 'aac', 'flac', 'wav']);
const IMAGE_EXTS = new Set(['webp', 'jpg', 'jpeg', 'png']);

function denoAssetName() {
  if (IS_WIN) return 'deno-x86_64-pc-windows-msvc.zip';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'deno-aarch64-apple-darwin.zip' : 'deno-x86_64-apple-darwin.zip';
  return process.arch === 'arm64' ? 'deno-aarch64-unknown-linux-gnu.zip' : 'deno-x86_64-unknown-linux-gnu.zip';
}
const DENO_URL = 'https://github.com/denoland/deno/releases/latest/download/' + denoAssetName();

function binDir() { const d = path.join(app.getPath('userData'), 'bin'); fs.mkdirSync(d, { recursive: true }); return d; }
function downloadDir() { const d = path.join(app.getPath('userData'), 'downloads'); fs.mkdirSync(d, { recursive: true }); return d; }
function ytdlpPath() { return path.join(binDir(), YTDLP_NAME); }
function denoPath() { return path.join(binDir(), DENO_NAME); }

function whichOnPath(cmd) {
  try {
    const out = execFileSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || null;
  } catch { return null; }
}
function nodeMajor(exe) {
  try { return parseInt(execFileSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true }).trim().replace(/^v/, ''), 10) || 0; }
  catch { return 0; }
}
function resolveJsRuntime() {
  if (fs.existsSync(denoPath())) return { kind: 'deno', args: ['--js-runtimes', 'deno:' + denoPath()] };
  if (whichOnPath('deno')) return { kind: 'deno', args: [] };
  const node = whichOnPath('node');
  if (node && nodeMajor(node) >= 20) return { kind: 'node', args: ['--js-runtimes', 'node:' + node] };
  return null;
}

function ytdlpStatus() {
  const rt = resolveJsRuntime();
  const hasYtdlp = fs.existsSync(ytdlpPath());
  return { platform: 'electron', ytdlp: hasYtdlp, runtime: rt ? rt.kind : null, ready: hasYtdlp && !!rt, binDir: binDir() };
}

function fetchToFile(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'Spootify' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(fetchToFile(new URL(res.headers.location, url).toString(), dest, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' downloading ' + url)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.on('data', (chunk) => { got += chunk.length; if (onProgress && total) onProgress(got / total); });
      res.pipe(out);
      out.on('finish', () => out.close(() => { try { fs.renameSync(tmp, dest); resolve(dest); } catch (e) { reject(e); } }));
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

function extractZip(zip, dir) {
  // Windows 10+, macOS: bsdtar reads zip. Linux GNU tar does not, so fall back to unzip.
  try { execFileSync('tar', ['-xf', zip, '-C', dir], { windowsHide: true, stdio: 'ignore' }); return; } catch {}
  execFileSync('unzip', ['-o', zip, '-d', dir], { stdio: 'ignore' });
}

async function ytdlpSetup(win) {
  const send = (stage, frac) => win && !win.isDestroyed() && win.webContents.send('ytdlp:progress', { stage, percent: Math.round(frac * 100) });
  if (!fs.existsSync(ytdlpPath())) {
    await fetchToFile(YTDLP_URL, ytdlpPath(), (f) => send('yt-dlp', f));
    if (!IS_WIN) fs.chmodSync(ytdlpPath(), 0o755);
  }
  if (!resolveJsRuntime()) {
    const zip = path.join(binDir(), 'deno.zip');
    await fetchToFile(DENO_URL, zip, (f) => send('deno', f));
    extractZip(zip, binDir());
    try { fs.unlinkSync(zip); } catch {}
    if (!IS_WIN && fs.existsSync(denoPath())) fs.chmodSync(denoPath(), 0o755);
  }
  return ytdlpStatus();
}

function lastErrorLine(text) {
  const lines = text.split(/\r?\n/).filter(l => /^ERROR:/i.test(l.trim()));
  return lines.length ? lines[lines.length - 1].trim().replace(/^ERROR:\s*/i, '') : '';
}

// The download in progress, so the renderer's Stop button can end it.
let activeDownload = null;
// yt-dlp is a PyInstaller bootloader that runs Python as a child process, so the whole
// tree has to go or the download carries on in the background. Elsewhere it runs in its
// own process group (detached in runYtdlp), so signalling the group gets every child.
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} } }
}

function runYtdlp(args, onLine, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ytdlpPath())) return reject(new Error('yt-dlp is not set up yet'));
    const rt = resolveJsRuntime();
    const full = [...(rt ? rt.args : []), opts.playlist ? '--yes-playlist' : '--no-playlist', '--no-warnings', ...args];
    const child = spawn(ytdlpPath(), full, { windowsHide: true, detached: !IS_WIN });
    if (opts.track) activeDownload = child;
    let out = '', err = '';
    const feed = (chunk, isErr) => {
      const s = chunk.toString();
      if (isErr) err += s; else out += s;
      if (onLine) s.split(/\r?\n|\r/).forEach(l => { if (l) onLine(l); });
    };
    child.stdout.on('data', c => feed(c, false));
    child.stderr.on('data', c => feed(c, true));
    child.on('error', reject);
    child.on('close', (code) => {
      if (activeDownload === child) activeDownload = null;
      if (child.stoppedByUser) reject(new Error('Download stopped'));
      else if (code === 0) resolve({ out, err });
      else reject(new Error(lastErrorLine(err) || lastErrorLine(out) || ('yt-dlp exited with code ' + code)));
    });
  });
}

async function ytdlpPlaylist(url) {
  const { out } = await runYtdlp(['--flat-playlist', '--print', PLAYLIST_TEMPLATE, url], null, { playlist: true });
  const entries = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.id);
  if (!entries.length) throw new Error('No videos found at that link');
  const titled = entries.find((e) => e.playlist_title);
  return { title: titled ? titled.playlist_title : 'Playlist', entries };
}

async function ytdlpInfo(url) {
  const { out } = await runYtdlp(['--print', INFO_TEMPLATE, url]);
  const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!line) throw new Error('yt-dlp returned no information');
  return JSON.parse(line);
}

async function ytdlpDownload(win, url, id) {
  const dir = downloadDir();
  const send = (percent) => win && !win.isDestroyed() && win.webContents.send('ytdlp:progress', { stage: 'download', percent });
  // Stale leftovers from a crashed (or stopped) run would confuse the id scan below.
  const clearLeftovers = () => { for (const f of fs.readdirSync(dir)) if (f.startsWith(id + '.')) { try { fs.unlinkSync(path.join(dir, f)); } catch {} } };
  clearLeftovers();
  try {
    await runYtdlp([
      '-f', AUDIO_FORMAT,
      '-o', path.join(dir, '%(id)s.%(ext)s'),
      '--write-thumbnail',
      '--no-simulate', '--progress', '--newline',
      '--progress-template', 'download:SPOOTIFY_PROGRESS %(progress._percent_str)s',
      url
    ], (line) => { const m = line.match(/SPOOTIFY_PROGRESS\s+([\d.]+)%/); if (m) send(parseFloat(m[1])); }, { track: true });
  } catch (e) {
    setTimeout(clearLeftovers, 1500); // after the killed process has released the .part file
    throw e;
  }

  const result = { audio: null, image: null };
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith(id + '.')) continue;
    const ext = f.slice(f.lastIndexOf('.') + 1).toLowerCase();
    const full = path.join(dir, f);
    if (IMAGE_EXTS.has(ext)) result.image = { ext, data: fs.readFileSync(full) };
    else if (AUDIO_EXTS.has(ext)) result.audio = { ext, data: fs.readFileSync(full) };
    try { fs.unlinkSync(full); } catch {}
  }
  if (!result.audio) throw new Error('Download finished but no audio file was produced');
  return result;
}

ipcMain.handle('ytdlp:status', () => ytdlpStatus());
ipcMain.handle('ytdlp:setup', (event) => ytdlpSetup(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle('ytdlp:info', (event, url) => ytdlpInfo(String(url || '')));
ipcMain.handle('ytdlp:playlist', (event, url) => ytdlpPlaylist(String(url || '')));
ipcMain.handle('ytdlp:cancel', () => {
  if (!activeDownload) return false;
  activeDownload.stoppedByUser = true;
  killTree(activeDownload);
  return true;
});
ipcMain.handle('ytdlp:download', (event, url, id) => ytdlpDownload(BrowserWindow.fromWebContents(event.sender), String(url || ''), String(id || '')));
ipcMain.handle('ytdlp:update', async () => {
  const { out, err } = await runYtdlp(['-U']);
  return { message: (out + '\n' + err).trim().split(/\r?\n/).filter(Boolean).pop() || 'Updated' };
});

// ══════════════════════════════════════════════
// ── APP UPDATES (desktop) ──
// Settings → General → App updates. Checks the latest GitHub release; installing downloads
// this platform's build, unpacks it next to the old one, and a small script copies it over
// the app folder once this process has quit, then starts the new version.
const UPDATE_REPO = 'ForsakenBlank/MusicApp';
const UPDATE_ASSETS = { linux: 'Spootify-linux-x64.tar.gz', win32: 'Spootify-windows-x64.zip' };
let updateInfo = null; // the last check's result, so install uses the same release

function getJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'Spootify', Accept: 'application/vnd.github+json' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(getJson(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 404) return reject(new Error('No releases found (is the GitHub repo public?)'));
        if (res.statusCode !== 200) return reject(new Error('GitHub answered HTTP ' + res.statusCode));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}
function versionParts(v) { return String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0); }
function isNewerVersion(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
// The folder holding the Spootify executable (dist/Spootify-linux-x64 or the unzipped Windows folder).
function appFolder() { return path.dirname(process.execPath); }
function cantInstallReason() {
  if (!UPDATE_ASSETS[process.platform]) return 'Updates from Settings work on Windows and Linux.';
  if (!app.isPackaged) return 'Running from source: pull the latest code and rebuild instead.';
  try { fs.accessSync(appFolder(), fs.constants.W_OK); } catch { return "Spootify can't write to its own folder, so download the update from the release page."; }
  return null;
}

ipcMain.handle('update:check', async () => {
  const rel = await getJson(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);
  const asset = (rel.assets || []).find((a) => a.name === UPDATE_ASSETS[process.platform]);
  updateInfo = {
    current: app.getVersion(),
    latest: String(rel.tag_name || '').replace(/^v/i, ''),
    notes: String(rel.body || '').slice(0, 4000),
    page: rel.html_url || `https://github.com/${UPDATE_REPO}/releases`,
    assetUrl: asset ? asset.browser_download_url : null
  };
  updateInfo.available = isNewerVersion(updateInfo.latest, updateInfo.current);
  updateInfo.cantInstall = !updateInfo.assetUrl ? `This release has no ${UPDATE_ASSETS[process.platform] || 'build'} for this computer.` : cantInstallReason();
  return updateInfo;
});

ipcMain.handle('update:install', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!updateInfo || !updateInfo.available || !updateInfo.assetUrl) throw new Error('Check for updates first');
  const reason = cantInstallReason(); if (reason) throw new Error(reason);
  const send = (stage, frac) => { if (win && !win.isDestroyed()) win.webContents.send('update:progress', { stage, percent: Math.round(frac * 100) }); };
  const work = fs.mkdtempSync(path.join(app.getPath('temp'), 'spootify-update-'));
  const archive = path.join(work, UPDATE_ASSETS[process.platform]);
  await fetchToFile(updateInfo.assetUrl, archive, (f) => send('download', f));
  send('unpack', 1);
  const unpacked = path.join(work, 'new');
  fs.mkdirSync(unpacked);
  if (process.platform === 'win32') extractZip(archive, unpacked);
  else execFileSync('tar', ['-xzf', archive, '-C', unpacked], { stdio: 'ignore' });
  // The archive holds one folder (Spootify-<platform>-x64); copy what's inside it.
  const entries = fs.readdirSync(unpacked);
  const src = entries.length === 1 && fs.statSync(path.join(unpacked, entries[0])).isDirectory() ? path.join(unpacked, entries[0]) : unpacked;
  const dest = appFolder(), exe = process.execPath;
  if (process.platform === 'win32') {
    const script = path.join(work, 'update.cmd');
    fs.writeFileSync(script, [
      '@echo off',
      ':wait',
      `tasklist /FI "PID eq ${process.pid}" | find "${process.pid}" >nul && (timeout /t 1 /nobreak >nul & goto wait)`,
      `robocopy "${src}" "${dest}" /E /R:5 /W:1 /NFL /NDL /NJH /NJS /NP >nul`,
      `start "" "${exe}"`,
      `rmdir /s /q "${work}"`
    ].join('\r\n'));
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    const script = path.join(work, 'update.sh');
    fs.writeFileSync(script, [
      '#!/bin/sh',
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
      'cp -a "$1"/. "$2"/',
      '"$3" >/dev/null 2>&1 &',
      'rm -rf "$4"'
    ].join('\n'), { mode: 0o755 });
    spawn('/bin/sh', [script, src, dest, exe, work], { detached: true, stdio: 'ignore' }).unref();
  }
  setTimeout(() => app.quit(), 300);
  return true;
});

// ══════════════════════════════════════════════
// ── TRAY (desktop) ──
// Closing the window hides it here and the music keeps playing. Clicking the icon opens
// the mini player (cover, previous / play / next, like); the menu has the same controls,
// the song that's on, and Quit. Opening the app again (e.g. from its launcher) brings the
// window back, since only one copy runs at a time.
// ══════════════════════════════════════════════
let tray = null, quitting = false, trayState = { title: '', artist: '', playing: false };
app.on('before-quit', () => { quitting = true; });
function showMain() {
  if (!mainWin || mainWin.isDestroyed()) { createWindow(); return; }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
}
function hideToTray() {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (tray) mainWin.hide(); else mainWin.minimize();
}
function trayCommand(type) { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('mini:command', { type }); }
function buildTrayMenu() {
  if (!tray) return;
  const t = trayState, song = t.title ? `${t.title}${t.artist ? ' — ' + t.artist : ''}` : 'Nothing playing';
  tray.setToolTip(t.title ? `Spootify · ${song}` : 'Spootify');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: song.length > 60 ? song.slice(0, 57) + '…' : song, enabled: false },
    { label: t.playing ? 'Pause' : 'Play', enabled: !!t.title, click: () => trayCommand('play-pause') },
    { label: 'Next', enabled: !!t.title, click: () => trayCommand('next') },
    { label: 'Previous', enabled: !!t.title, click: () => trayCommand('prev') },
    { type: 'separator' },
    { label: 'Mini player', click: () => openMini() },
    { label: 'Show Spootify', click: showMain },
    { type: 'separator' },
    { label: 'Quit Spootify', click: () => { quitting = true; app.quit(); } }
  ]));
}
function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'www', 'icon.png')).resize({ width: 24, height: 24 });
    tray = new Tray(icon);
    tray.on('click', () => { if (miniWin && !miniWin.isDestroyed() && miniWin.isVisible()) miniWin.close(); else openMini(); });
    tray.on('double-click', showMain);
    buildTrayMenu();
  } catch (e) { console.warn('No tray icon', e); tray = null; }
}
ipcMain.on('tray:state', (event, s) => {
  const next = { title: String((s && s.title) || ''), artist: String((s && s.artist) || ''), playing: !!(s && s.playing) };
  if (next.title === trayState.title && next.artist === trayState.artist && next.playing === trayState.playing) return;
  trayState = next; buildTrayMenu();
});
ipcMain.on('app:hide-to-tray', hideToTray);
ipcMain.on('app:quit', () => { quitting = true; app.quit(); });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showMain);
  app.whenReady().then(() => { createWindow(); createTray(); });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
