import os
import json
import base64
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageTk, ImageDraw

# Try to import mutagen for real duration, otherwise fallback to estimate
try:
    from mutagen.mp3 import MP3
    from mutagen.wavpack import WavPack
    HAS_MUTAGEN = True
except ImportError:
    HAS_MUTAGEN = False

DEFAULT_ART_RED = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5CYII="

class PlaylistBuilderApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Prism Playlist Asset Packager Pro")
        self.root.geometry("650x750")
        
        self.songs = []
        self.playlist_image_base64 = DEFAULT_ART_RED
        
        # Drag and Drop State Elements
        self.drag_index = None
        self.drag_popup = None
        self.drop_indicator = None
        self.target_index = None

        # --- UI LAYOUT ---
        # Playlist Setup Frame
        setup_frame = tk.LabelFrame(root, text=" 1. Playlist Configuration ", font=("Arial", 10, "bold"), padx=10, pady=10)
        setup_frame.pack(fill="x", padx=15, pady=10)
        
        tk.Label(setup_frame, text="Playlist Name:").grid(row=0, column=0, sticky="w", pady=5)
        self.playlist_name_entry = tk.Entry(setup_frame, width=30)
        self.playlist_name_entry.insert(0, "My Automated Playlist")
        self.playlist_name_entry.grid(row=0, column=1, padx=5, pady=5, sticky="w")
        
        self.playlist_cover_label = tk.Label(setup_frame, text="No Cover Image", bg="red", width=12, height=3, fg="white")
        self.playlist_cover_label.grid(row=0, column=2, rowspan=2, padx=15)
        
        tk.Button(setup_frame, text="Set Playlist Cover", command=self.set_playlist_cover).grid(row=1, column=0, columnspan=2, sticky="w")

        # Action Buttons Frame (Folder Select & Auto-Sort)
        action_frame = tk.Frame(root)
        action_frame.pack(fill="x", padx=15, pady=5)
        
        # Grid setup to sit buttons cleanly side-by-side
        action_frame.columnconfigure(0, weight=3)
        action_frame.columnconfigure(1, weight=1)

        tk.Button(action_frame, text="Select Track Source Folder", font=("Arial", 10, "bold"), bg="#1DB954", fg="white", command=self.load_source_folder, height=2).grid(row=0, column=0, sticky="ew", padx=(0, 5))
        
        # NEW: Auto-Sort Button
        tk.Button(action_frame, text="Sort by Artist A-Z", font=("Arial", 10, "bold"), bg="#333333", fg="white", activebackground="#444444", activeforeground="white", command=self.sort_by_artist, height=2).grid(row=0, column=1, sticky="ew", padx=(5, 0))

        # Scrollable Frame Area
        list_label = tk.Label(root, text="2. Drag & Drop Tracks to Re-order / Edit Metadata", font=("Arial", 10, "bold"))
        list_label.pack(anchor="w", padx=15, pady=(10, 2))
        
        self.canvas_frame = tk.Frame(root)
        self.canvas_frame.pack(fill="both", expand=True, padx=15, pady=5)
        
        self.canvas = tk.Canvas(self.canvas_frame, bg="#121212", highlightthickness=0)
        self.scrollbar = ttk.Scrollbar(self.canvas_frame, orient="vertical", command=self.canvas.yview)
        self.scrollable_frame = tk.Frame(self.canvas, bg="#121212")
        
        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )
        self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw", width=595)
        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        
        self.canvas.pack(side="left", fill="both", expand=True)
        self.scrollbar.pack(side="right", fill="y")

        # --- FIX: Bind physical mouse scroll wheel instantly ---
        self.canvas.bind_all("<MouseWheel>", lambda event: self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units"))
        self.canvas.bind_all("<Button-4>", lambda event: self.canvas.yview_scroll(-1, "units"))
        self.canvas.bind_all("<Button-5>", lambda event: self.canvas.yview_scroll(1, "units"))

        # Bottom Controls
        bottom_frame = tk.Frame(root, pady=10)
        bottom_frame.pack(fill="x", padx=15)
        
        self.status_label = tk.Label(bottom_frame, text="0 Songs Loaded", fg="grey")
        self.status_label.pack(side="left")

        # NEW: Split Checkbox
        self.split_var = tk.BooleanVar(value=False)
        self.split_cb = tk.Checkbutton(bottom_frame, text="Split into 5 files", variable=self.split_var)
        self.split_cb.pack(side="left", padx=20)

        tk.Button(bottom_frame, text="Export JSON for App", font=("Arial", 10, "bold"), bg="#2d4263", fg="white", command=self.export_json_payload, width=20).pack(side="right")

    def file_to_base64(self, file_path, mime_type):
        try:
            with open(file_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")
                return f"data:{mime_type};base64,{encoded}"
        except Exception:
            return None

    def get_audio_duration(self, file_path):
        if not HAS_MUTAGEN:
            return 180 # Default fallback
        try:
            if file_path.lower().endswith('.mp3'):
                audio = MP3(file_path)
                return int(audio.info.length)
            return 180
        except Exception:
            return 180

    def create_red_square_base64(self):
        img = Image.new("RGB", (100, 100), color="red")
        from io import BytesIO
        buffered = BytesIO()
        img.save(buffered, format="PNG")
        return f"data:image/png;base64,{base64.b64encode(buffered.getvalue()).decode('utf-8')}"

    def set_playlist_cover(self):
        file_path = filedialog.askopenfilename(filetypes=[("Images", "*.png *.jpg *.jpeg *.webp *.gif")])
        if file_path:
            b64 = self.file_to_base64(file_path, "image/png")
            if b64:
                self.playlist_image_base64 = b64
                self.playlist_cover_label.config(text="Custom Cover", bg="#1DB954")

    def load_source_folder(self):
        root_dir = filedialog.askdirectory()
        if not root_dir:
            return
            
        self.songs = []
        valid_audio = ('.mp3', '.wav', '.webm', '.m4a')
        valid_images = ('.png', '.jpg', '.jpeg', '.webp', '.gif')
        
        for folder_name in os.listdir(root_dir):
            folder_path = os.path.join(root_dir, folder_name)
            if not os.path.isdir(folder_path):
                continue
                
            if " - " in folder_name:
                parts = folder_name.split(" - ", 1)
                title = parts[0].strip()
                artist = parts[1].strip()
            else:
                title = folder_name.strip()
                artist = "Unknown Artist"
                
            audio_file = None
            image_file = None
            
            for file in os.listdir(folder_path):
                f_path = os.path.join(folder_path, file)
                if file.lower().endswith(valid_audio) and not audio_file:
                    audio_file = f_path
                elif file.lower().endswith(valid_images) and not image_file:
                    image_file = f_path
            
            # Skip if no audio file was found at all
            if not audio_file:
                continue

            audio_b64 = self.file_to_base64(audio_file, "audio/mpeg" if audio_file and audio_file.lower().endswith('.mp3') else "audio/webm")

            # Additional safety check for base64 success
            if not audio_b64:
                continue

            duration = self.get_audio_duration(audio_file)

            has_custom_image = False
            if image_file:
                image_b64 = self.file_to_base64(image_file, "image/png")
                has_custom_image = True
            else:
                image_b64 = self.create_red_square_base64()

            # Use numeric ID consistent with app.js (Date.now() style)
            song_id = int(time.time() * 1000) + len(self.songs)

            self.songs.append({
                "id": song_id,
                "title": title,
                "artist": artist,
                "art": image_b64,
                "has_custom_art": has_custom_image,
                "fileSrc": audio_b64,
                "duration": duration,
                "timestamp": int(os.path.getmtime(audio_file)) * 1000
            })
                
        self.render_songs_list()
        self.status_label.config(text=f"{len(self.songs)} Songs Loaded")

    # NEW: Artist Auto-Sorter Engine Function
    def sort_by_artist(self):
        if not self.songs:
            messagebox.showwarning("Sort Error", "No tracks are loaded to sort yet!")
            return
        
        # Sort internal data array using lower-case properties to keep it completely case-insensitive
        self.songs.sort(key=lambda x: x["artist"].lower())
        
        # Force a UI update to redraw the list completely clean
        self.render_songs_list()
        messagebox.showinfo("Sorted!", "Your playlist has been ordered alphabetically by artist name!")

    def render_songs_list(self):
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()
            
        for index, song in enumerate(self.songs):
            row = tk.Frame(self.scrollable_frame, bg="#1E1E1E", height=75)
            row.pack(fill="x", padx=5, pady=4)
            row.pack_propagate(False)
            
            # Interactive drag bindings
            row.bind("<Button-1>", lambda event, idx=index: self.start_drag(event, idx))
            row.bind("<B1-Motion>", self.drag_motion)
            row.bind("<ButtonRelease-1>", self.end_drag)

            # Left Art Indicator
            bg_color = "#1DB954" if song["has_custom_art"] else "red"
            lbl_txt = "🖼️" if song["has_custom_art"] else "❌"
            img_box = tk.Label(row, text=lbl_txt, bg=bg_color, fg="white", width=6, font=("Arial", 12))
            img_box.pack(side="left", fill="y", padx=(0, 10))
            
            # Text Metadata Layout block
            info_frame = tk.Frame(row, bg="#1E1E1E")
            info_frame.pack(side="left", fill="both", expand=True, pady=8)
            
            lbl_title = tk.Label(info_frame, text=song["title"], fg="white", bg="#1E1E1E", font=("Arial", 11, "bold"), anchor="w")
            lbl_title.pack(fill="x")
            lbl_artist = tk.Label(info_frame, text=song["artist"], fg="#b3b3b3", bg="#1E1E1E", font=("Arial", 10), anchor="w")
            lbl_artist.pack(fill="x")

            # Right Side Container for Status and Edit Button
            right_frame = tk.Frame(row, bg="#1E1E1E")
            right_frame.pack(side="right", fill="y", padx=5)

            # Edit Button
            btn_edit = tk.Button(right_frame, text="Edit", font=("Arial", 9, "bold"), bg="#333333", fg="white", activebackground="#555555", activeforeground="white", bd=0, padx=8, command=lambda idx=index: self.open_edit_popup(idx))
            btn_edit.pack(side="right", padx=5, pady=22)

            # Audio File Status Label
            if song["fileSrc"]:
                status_text, status_color = "Audio Loaded ✓", "#1DB954"
            else:
                status_text, status_color = "Missing Audio ⚠", "red"
            
            lbl_status = tk.Label(right_frame, text=status_text, fg=status_color, bg="#1E1E1E", font=("Arial", 9, "italic"))
            lbl_status.pack(side="right", padx=5, pady=25)

            # Route interior widget click actions upwards (excluding the edit button)
            for child in (img_box, info_frame, lbl_title, lbl_artist, right_frame, lbl_status):
                child.bind("<Button-1>", lambda event, idx=index: self.start_drag(event, idx))
                child.bind("<B1-Motion>", self.drag_motion)
                child.bind("<ButtonRelease-1>", self.end_drag)

    def open_edit_popup(self, index):
        song = self.songs[index]
        
        popup = tk.Toplevel(self.root)
        popup.title(f"Edit Track Details")
        popup.geometry("400x250")
        popup.resizable(False, False)
        popup.grab_set() 
        
        self.temp_art_b64 = song["art"]
        self.temp_has_custom_art = song["has_custom_art"]

        tk.Label(popup, text="Song Title:", font=("Arial", 10, "bold")).pack(anchor="w", padx=20, pady=(15, 2))
        title_entry = tk.Entry(popup, width=45, font=("Arial", 10))
        title_entry.insert(0, song["title"])
        title_entry.pack(padx=20, fill="x")

        tk.Label(popup, text="Artist / Author:", font=("Arial", 10, "bold")).pack(anchor="w", padx=20, pady=(10, 2))
        artist_entry = tk.Entry(popup, width=45, font=("Arial", 10))
        artist_entry.insert(0, song["artist"])
        artist_entry.pack(padx=20, fill="x")

        art_frame = tk.Frame(popup, pady=15)
        art_frame.pack(fill="x", padx=20)
        
        status_color = "#1DB954" if self.temp_has_custom_art else "red"
        status_text = "Custom Art Loaded" if self.temp_has_custom_art else "Using Default (Red)"
        lbl_art_status = tk.Label(art_frame, text=status_text, fg=status_color, font=("Arial", 9, "italic"))
        lbl_art_status.pack(side="left")

        def choose_new_art():
            file_path = filedialog.askopenfilename(filetypes=[("Images", "*.png *.jpg *.jpeg *.webp *.gif")])
            if file_path:
                b64 = self.file_to_base64(file_path, "image/png")
                if b64:
                    self.temp_art_b64 = b64
                    self.temp_has_custom_art = True
                    lbl_art_status.config(text="New Art Loaded ✓", fg="#1DB954")

        tk.Button(art_frame, text="Change Artwork", command=choose_new_art).pack(side="right")

        btn_frame = tk.Frame(popup)
        btn_frame.pack(side="bottom", fill="x", pady=15, padx=20)

        def save_changes():
            new_title = title_entry.get().strip()
            new_artist = artist_entry.get().strip()
            
            if not new_title:
                messagebox.showerror("Error", "Song title cannot be blank.", parent=popup)
                return
                
            self.songs[index]["title"] = new_title
            self.songs[index]["artist"] = new_artist if new_artist else "Unknown Artist"
            self.songs[index]["art"] = self.temp_art_b64
            self.songs[index]["has_custom_art"] = self.temp_has_custom_art
            
            popup.destroy()
            self.render_songs_list() 

        tk.Button(btn_frame, text="Cancel", width=10, command=popup.destroy).pack(side="left")
        tk.Button(btn_frame, text="Save Details", width=12, bg="#1DB954", fg="white", font=("Arial", 9, "bold"), command=save_changes).pack(side="right")

    def start_drag(self, event, index):
        self.drag_index = index
        song = self.songs[index]
        
        self.drag_popup = tk.Toplevel()
        self.drag_popup.wm_overrideredirect(True)
        self.drag_popup.attributes("-alpha", 0.75)
        
        inner_frame = tk.Frame(self.drag_popup, bg="#282828", bd=2, relief="solid", padx=10, pady=5)
        inner_frame.pack()
        tk.Label(inner_frame, text=f"Moving: {song['title']}", fg="#1DB954", bg="#282828", font=("Arial", 10, "bold")).pack()
        
        self.drag_motion(event)

    def drag_motion(self, event):
        if not self.drag_popup:
            return
            
        x = event.x_root + 15
        y = event.y_root + 15
        self.drag_popup.geometry(f"+{x}+{y}")
        
        if self.drop_indicator:
            self.drop_indicator.destroy()
            self.drop_indicator = None
            
        self.target_index = None
        
        canvas_y = self.canvas.winfo_rooty()
        frame_y = event.y_root - canvas_y + self.canvas.yview()[0] * self.scrollable_frame.winfo_height()
        
        children = self.scrollable_frame.winfo_children()
        if not children:
            return

        for idx, child in enumerate(children):
            child_top = child.winfo_y()
            child_middle = child_top + (child.winfo_height() / 2)
            
            if frame_y < child_middle:
                self.target_index = idx
                self.drop_indicator = tk.Frame(self.scrollable_frame, bg="#1DB954", height=4)
                self.drop_indicator.pack(fill="x", padx=5, before=child)
                break
        else:
            self.target_index = len(children)
            self.drop_indicator = tk.Frame(self.scrollable_frame, bg="#1DB954", height=4)
            self.drop_indicator.pack(fill="x", padx=5)

    def end_drag(self, event):
        if self.drag_popup:
            self.drag_popup.destroy()
            self.drag_popup = None
            
        if self.drop_indicator:
            self.drop_indicator.destroy()
            self.drop_indicator = None
            
        if self.drag_index is not None and self.target_index is not None:
            old_idx = self.drag_index
            new_idx = self.target_index
            
            if new_idx > old_idx:
                new_idx -= 1
                
            if old_idx != new_idx and 0 <= new_idx < len(self.songs):
                moved_item = self.songs.pop(old_idx)
                self.songs.insert(new_idx, moved_item)
                self.render_songs_list()
                
        self.drag_index = None
        self.target_index = None

    def export_json_payload(self):
        if not self.songs:
            messagebox.showwarning("Empty", "No track structures loaded to export.")
            return
            
        p_name = self.playlist_name_entry.get().strip() or "Automated Playlist"

        def create_payload(song_chunk):
            assets = {}
            asset_map = {}
            asset_counter = 1

            def register_asset(data_string, data_type):
                nonlocal asset_counter
                if not data_string:
                    return None
                if data_string not in asset_map:
                    asset_id = f"{data_type}-{asset_counter}"
                    asset_counter += 1
                    asset_map[data_string] = asset_id
                    assets[asset_id] = {"type": data_type, "data": data_string}
                return {"assetRef": asset_map[data_string]}

            playlist_art_ref = register_asset(self.playlist_image_base64, "image")
            
            compact_songs = []
            for song in song_chunk:
                compact_songs.append({
                    "id": song["id"],
                    "title": song["title"],
                    "artist": song["artist"],
                    "duration": song["duration"],
                    "timestamp": song["timestamp"],
                    "art": register_asset(song["art"], "image"),
                    "fileSrc": register_asset(song["fileSrc"], "audio")
                })

            playlists_export = {
                p_name: {
                    "name": p_name,
                    "art": playlist_art_ref,
                    "songs": compact_songs
                }
            }

            return {
                "version": 2,
                "playlists": playlists_export,
                "currentPlaylist": p_name,
                "queue": [],
                "assets": assets,
                "exportedAt": "2026-06-07T00:00:00.000Z"
            }

        save_path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON Files", "*.json")])
        if not save_path:
            return

        if self.split_var.get():
            # Split into 5 parts
            num_songs = len(self.songs)
            chunk_size = (num_songs + 4) // 5 # Ceiling division
            for i in range(5):
                start = i * chunk_size
                end = min(start + chunk_size, num_songs)
                if start >= num_songs:
                    break

                chunk = self.songs[start:end]
                payload = create_payload(chunk)

                part_path = save_path.replace(".json", f"_part{i+1}.json")
                with open(part_path, "w") as f:
                    json.dump(payload, f, indent=2)

            messagebox.showinfo("Success!", f"Playlist exported in {i+1} parts successfully!")
        else:
            # Export single file
            payload = create_payload(self.songs)
            with open(save_path, "w") as f:
                json.dump(payload, f, indent=2)
            messagebox.showinfo("Success!", "Your playlist JSON file was exported successfully!")

if __name__ == "__main__":
    root = tk.Tk()
    app = PlaylistBuilderApp(root)
    root.mainloop()