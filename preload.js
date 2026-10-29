const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (data, defaultName) => ipcRenderer.invoke('save-file', data, defaultName),
  // Why the page crashed last time, if it did (main.js reloads it), once.
  takeCrash: () => ipcRenderer.invoke('app:take-crash'),
  // Library export, written part by part into a folder you pick (see main.js).
  exportFiles: {
    pickFolder: () => ipcRenderer.invoke('export:pick-folder'),
    open: (dir, name) => ipcRenderer.invoke('export:open', dir, name),
    write: (id, text) => ipcRenderer.invoke('export:write', id, text),
    close: (id, discard) => ipcRenderer.invoke('export:close', id, !!discard)
  },
  // Wi-Fi sync host (see main.js): turn the local server on/off, answer its requests.
  sync: {
    host: (on) => ipcRenderer.invoke('sync:host', !!on),
    onRequest: (callback) => {
      const handler = (_event, id, body) => callback(id, body);
      ipcRenderer.on('sync:request', handler);
      return () => ipcRenderer.removeListener('sync:request', handler);
    },
    reply: (id, answer) => ipcRenderer.send('sync:reply', id, answer)
  },
  // App updates from GitHub releases (see main.js): check, then download and restart.
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    info: () => ipcRenderer.invoke('update:info'),
    // a version picks that release (newer or older); none installs the one the last check found
    install: (version) => ipcRenderer.invoke('update:install', version ? String(version) : undefined),
    onProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('update:progress', handler);
      return () => ipcRenderer.removeListener('update:progress', handler);
    }
  },
  // Tray (see main.js): hide the window there or quit, and tell it what's playing.
  tray: {
    hide: () => ipcRenderer.send('app:hide-to-tray'),
    quit: () => ipcRenderer.send('app:quit'),
    setState: (state) => ipcRenderer.send('tray:state', state)
  },
  // The theme's base colour, used as the window background on the next launch.
  setBackground: (color) => ipcRenderer.send('app:set-background', String(color || '')),
  // Settings -> Appearance -> App icon: the window, mini player and tray icon colours.
  setAppIcon: (name) => ipcRenderer.send('app:set-icon', String(name || '')),
  // Mini player window (see main.js): the main window pushes state, the mini window sends commands.
  mini: {
    toggle: () => ipcRenderer.send('mini:toggle'),
    sendState: (state) => ipcRenderer.send('mini:state', state),
    command: (cmd) => ipcRenderer.send('mini:command', cmd),
    on: (channel, callback) => {
      if (!['mini:state', 'mini:command', 'mini:opened', 'mini:closed'].includes(channel)) return () => {};
      const handler = (_event, data) => callback(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  },
  // Desktop yt-dlp bridge; mirrors the Android YtDlp Capacitor plugin (see app.v2.js ytBackend).
  ytdlp: {
    status: () => ipcRenderer.invoke('ytdlp:status'),
    setup: () => ipcRenderer.invoke('ytdlp:setup'),
    info: (url) => ipcRenderer.invoke('ytdlp:info', url),
    playlist: (url) => ipcRenderer.invoke('ytdlp:playlist', url),
    download: (url, id) => ipcRenderer.invoke('ytdlp:download', url, id),
    cancel: () => ipcRenderer.invoke('ytdlp:cancel'),
    update: () => ipcRenderer.invoke('ytdlp:update'),
    onProgress: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('ytdlp:progress', handler);
      return () => ipcRenderer.removeListener('ytdlp:progress', handler);
    }
  }
});
