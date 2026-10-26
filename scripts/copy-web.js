// Copies the shared web files from the project root into www/, which Capacitor packs
// into the Android app. Edit the files in the root; www/main.js (the Android-only
// entry point) is the one file that lives in www/ itself.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const FILES = [
    "app.v2.js", "dj.js", "icon.png", "index.html", "lame.min.js", "manifest.json",
    "mini.html", "style.css", "sw.js", "sync.js", "tags.js", "themes.js", "trim-worker.js"
];

fs.mkdirSync(path.join(root, "www"), { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(root, f), path.join(root, "www", f));
console.log(`Copied ${FILES.length} files into www/`);
