const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    },
    backgroundColor: '#121212'
  });

  win.loadFile('index.html');
  win.setMenuBarVisibility(false);
}

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
