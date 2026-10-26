// ══════════════════════════════════════════════
// ── AUDIO TAG READER ──
// Pulls title / artist / album / cover art out of audio files so songs can be
// added in bulk without typing anything. Reads only the bytes it needs (File.slice),
// so even big files are cheap. Handles:
//   ID3v2.2/2.3/2.4 (+ ID3v1 fallback)  mp3, aac, some wav/flac
//   MP4 / M4A iTunes atoms               m4a, mp4, aac
//   FLAC Vorbis comments + PICTURE       flac
//   Ogg Vorbis / Opus comments           ogg, oga, opus
//   RIFF INFO / embedded id3 chunk       wav
// Anything missing falls back to the file name ("Artist - Title.mp3").
// window.SpootifyTags.read(file) -> { title, artist, album, year, track, picture: Blob|null }
// ══════════════════════════════════════════════
(function () {
    const dec = (label) => { try { return new TextDecoder(label); } catch { return null; } };
    const TD = { latin1: dec("latin1") || dec("utf-8"), utf8: dec("utf-8"), le: dec("utf-16le"), be: dec("utf-16be") };

    async function bytes(file, start, end) {
        start = Math.max(0, start); end = Math.min(file.size, end);
        if (end <= start) return new Uint8Array(0);
        return new Uint8Array(await file.slice(start, end).arrayBuffer());
    }
    function ascii(b, s, e) { let out = ""; for (let i = s; i < e && i < b.length; i++) out += String.fromCharCode(b[i]); return out; }
    function u32be(b, p) { return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }
    function u32le(b, p) { return b[p] + (b[p + 1] << 8) + (b[p + 2] << 16) + ((b[p + 3] << 24) >>> 0); }
    function synchsafe(b, p) { return (b[p] & 0x7f) * 0x200000 + (b[p + 1] & 0x7f) * 0x4000 + (b[p + 2] & 0x7f) * 0x80 + (b[p + 3] & 0x7f); }
    function clean(s) { return String(s || "").replace(/\u0000+/g, " ").replace(/\s+/g, " ").trim(); }
    // Undo ID3 "unsynchronisation": every 0xFF 0x00 pair was written for a 0xFF.
    function unsync(b) {
        const out = new Uint8Array(b.length); let n = 0;
        for (let i = 0; i < b.length; i++) { out[n++] = b[i]; if (b[i] === 0xff && b[i + 1] === 0x00) i++; }
        return out.subarray(0, n);
    }

    // ── ID3v2 ──
    function decodeId3Text(b, enc) {
        if (!b.length) return "";
        let s;
        if (enc === 1) {
            if (b[0] === 0xff && b[1] === 0xfe) s = TD.le.decode(b.subarray(2));
            else if (b[0] === 0xfe && b[1] === 0xff) s = TD.be.decode(b.subarray(2));
            else s = TD.le.decode(b);
        } else if (enc === 2) s = TD.be.decode(b);
        else if (enc === 3) s = TD.utf8.decode(b);
        else s = TD.latin1.decode(b);
        // Multiple values (v2.4) are NUL-separated: "A\0B" -> "A, B".
        return s.split("\u0000").map((x) => x.trim()).filter(Boolean).join(", ");
    }
    // Index just past a NUL terminator (1 byte for latin1/utf8, 2 aligned bytes for utf16).
    function skipTerminated(b, p, enc) {
        if (enc === 1 || enc === 2) { for (let i = p; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i + 2; return b.length; }
        for (let i = p; i < b.length; i++) if (b[i] === 0) return i + 1;
        return b.length;
    }
    const ID3_TEXT = { TIT2: "title", TT2: "title", TPE1: "artist", TP1: "artist", TPE2: "albumArtist", TP2: "albumArtist", TALB: "album", TAL: "album", TYER: "year", TYE: "year", TDRC: "year", TRCK: "track", TRK: "track" };

    function parseId3Frames(data, ver, out) {
        const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
        let pos = 0;
        const looksLikeFrame = (p) => p >= data.length || data[p] === 0 || /^[A-Z0-9]{3,4}$/.test(ascii(data, p, p + idLen));
        while (pos + hdrLen <= data.length) {
            const id = ascii(data, pos, pos + idLen);
            if (!/^[A-Z0-9]+$/.test(id)) break; // padding
            let size;
            if (ver === 2) size = (data[pos + 3] << 16) | (data[pos + 4] << 8) | data[pos + 5];
            else if (ver === 4) {
                size = synchsafe(data, pos + 4);
                // Some taggers (old iTunes) wrote plain sizes into v2.4 tags.
                const plain = u32be(data, pos + 4);
                if (plain !== size && !looksLikeFrame(pos + hdrLen + size) && looksLikeFrame(pos + hdrLen + plain)) size = plain;
            } else size = u32be(data, pos + 4);
            const flags = ver === 2 ? 0 : (data[pos + 8] << 8) | data[pos + 9];
            const start = pos + hdrLen, end = start + size;
            if (size <= 0 || end > data.length) break;
            pos = end;
            let frame = data.subarray(start, end);
            if (ver === 4) {
                if (flags & 0x000c) continue; // compressed / encrypted
                let skip = 0;
                if (flags & 0x0040) skip += 1; // grouping id
                if (flags & 0x0001) skip += 4; // data length indicator
                frame = frame.subarray(skip);
                if (flags & 0x0002) frame = unsync(frame);
            } else if (ver === 3 && (flags & 0x00c0)) continue;
            if (ID3_TEXT[id]) {
                if (!out[ID3_TEXT[id]]) out[ID3_TEXT[id]] = clean(decodeId3Text(frame.subarray(1), frame[0]));
            } else if (id === "APIC" || id === "PIC") {
                const enc = frame[0];
                let p = 1, mime;
                if (id === "PIC") { const fmt = ascii(frame, 1, 4).toLowerCase(); mime = fmt === "png" ? "image/png" : "image/jpeg"; p = 4; }
                else { const e = skipTerminated(frame, 1, 0); mime = ascii(frame, 1, e - 1).toLowerCase() || "image/jpeg"; p = e; }
                const type = frame[p]; p = skipTerminated(frame, p + 1, enc);
                const img = frame.subarray(p);
                if (img.length > 64 && (!out._pic || (type === 3 && out._picType !== 3))) {
                    out._pic = img; out._picType = type;
                    out._picMime = mime.includes("/") ? mime : "image/" + (mime === "jpg" ? "jpeg" : mime);
                }
            }
        }
    }
    async function readId3v2(file, offset) {
        const head = await bytes(file, offset, offset + 10);
        if (ascii(head, 0, 3) !== "ID3") return null;
        const ver = head[3], flags = head[5], size = synchsafe(head, 6);
        if (ver < 2 || ver > 4) return null;
        let data = await bytes(file, offset + 10, offset + 10 + size);
        if ((flags & 0x80) && ver < 4) data = unsync(data);
        let start = 0;
        if (flags & 0x40) start = ver === 3 ? 4 + u32be(data, 0) : ver === 4 ? synchsafe(data, 0) : 0;
        const out = {};
        parseId3Frames(data.subarray(start), ver, out);
        return out;
    }
    async function readId3v1(file) {
        if (file.size < 128) return null;
        const b = await bytes(file, file.size - 128, file.size);
        if (ascii(b, 0, 3) !== "TAG") return null;
        const field = (s, e) => clean(TD.latin1.decode(b.subarray(s, e)));
        return { title: field(3, 33), artist: field(33, 63), album: field(63, 93), year: field(93, 97) };
    }

    // ── MP4 / M4A ──
    function boxes(b, start, end, fn) {
        let p = start;
        while (p + 8 <= end) {
            let size = u32be(b, p), hdr = 8;
            const type = ascii(b, p + 4, p + 8);
            if (size === 1) { size = u32be(b, p + 8) * 4294967296 + u32be(b, p + 12); hdr = 16; }
            else if (size === 0) size = end - p;
            if (size < hdr || p + size > end) break;
            if (fn(type, p + hdr, p + size) === false) return;
            p += size;
        }
    }
    function findBox(b, start, end, type) { let r = null; boxes(b, start, end, (t, s, e) => { if (t === type) { r = { s, e }; return false; } }); return r; }
    function parseMoov(m) {
        const udta = findBox(m, 0, m.length, "udta"); if (!udta) return null;
        const meta = findBox(m, udta.s, udta.e, "meta"); if (!meta) return null;
        // "meta" is a full box (4 bytes version/flags) in MP4, but not in some QuickTime files.
        const off = ascii(m, meta.s + 4, meta.s + 8) === "hdlr" ? 0 : 4;
        const ilst = findBox(m, meta.s + off, meta.e, "ilst"); if (!ilst) return null;
        const out = {};
        const MAP = { "©nam": "title", "©ART": "artist", "aART": "albumArtist", "©alb": "album", "©day": "year" };
        boxes(m, ilst.s, ilst.e, (type, s, e) => {
            const data = findBox(m, s, e, "data"); if (!data) return;
            const kind = u32be(m, data.s) & 0xffffff, payload = m.subarray(data.s + 8, data.e);
            if (MAP[type]) { if (!out[MAP[type]]) out[MAP[type]] = clean(TD.utf8.decode(payload)); }
            else if (type === "covr" && payload.length > 64 && !out._pic) { out._pic = payload; out._picMime = kind === 14 ? "image/png" : "image/jpeg"; }
            else if (type === "trkn" && payload.length >= 4) { const n = (payload[2] << 8) | payload[3]; if (n) out.track = String(n); }
        });
        return out;
    }
    async function readMp4(file) {
        let p = 0;
        for (let guard = 0; guard < 64 && p + 8 <= file.size; guard++) {
            const h = await bytes(file, p, p + 16);
            let size = u32be(h, 0), hdr = 8;
            const type = ascii(h, 4, 8);
            if (size === 1) { size = u32be(h, 8) * 4294967296 + u32be(h, 12); hdr = 16; }
            else if (size === 0) size = file.size - p;
            if (size < hdr) break;
            if (type === "moov") {
                if (size > 96 * 1024 * 1024) return null;
                return parseMoov(await bytes(file, p + hdr, p + size));
            }
            p += size;
        }
        return null;
    }

    // ── Vorbis comments (FLAC / Ogg) ──
    function parsePictureBlock(b, out) {
        if (out._pic || b.length < 32) return;
        let p = 4; const mimeLen = u32be(b, p); p += 4;
        const mime = ascii(b, p, p + mimeLen); p += mimeLen;
        const descLen = u32be(b, p); p += 4 + descLen + 16;
        const len = u32be(b, p); p += 4;
        if (len > 64 && p + len <= b.length) { out._pic = b.subarray(p, p + len); out._picMime = mime || "image/jpeg"; }
    }
    function parseVorbisComments(b, p, out) {
        const vendor = u32le(b, p); p += 4 + vendor;
        const count = u32le(b, p); p += 4;
        const KEYS = { TITLE: "title", ARTIST: "artist", ALBUMARTIST: "albumArtist", "ALBUM ARTIST": "albumArtist", ALBUM: "album", DATE: "year", YEAR: "year", TRACKNUMBER: "track" };
        for (let i = 0; i < count && p + 4 <= b.length; i++) {
            const len = u32le(b, p); p += 4;
            if (p + len > b.length) break;
            const entry = b.subarray(p, p + len); p += len;
            let eq = entry.indexOf(0x3d); if (eq < 0) continue;
            const key = ascii(entry, 0, eq).toUpperCase();
            if (key === "METADATA_BLOCK_PICTURE") {
                try { const bin = atob(ascii(entry, eq + 1, entry.length)); const arr = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j); parsePictureBlock(arr, out); } catch {}
            } else if (KEYS[key] && !out[KEYS[key]]) out[KEYS[key]] = clean(TD.utf8.decode(entry.subarray(eq + 1)));
        }
    }
    async function readFlac(file) {
        const out = {}; let p = 4;
        for (let i = 0; i < 128 && p + 4 <= file.size; i++) {
            const h = await bytes(file, p, p + 4);
            const last = h[0] & 0x80, type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3];
            if (type === 4 || type === 6) {
                const body = await bytes(file, p + 4, p + 4 + len);
                if (type === 4) parseVorbisComments(body, 0, out); else parsePictureBlock(body, out);
            }
            p += 4 + len;
            if (last) break;
        }
        return out;
    }
    async function readOgg(file) {
        // The comment header is the second packet; with embedded art it can span many pages.
        const b = await bytes(file, 0, Math.min(file.size, 6 * 1024 * 1024));
        const packets = []; let cur = [], p = 0;
        while (p + 27 <= b.length && packets.length < 2) {
            if (ascii(b, p, p + 4) !== "OggS") break;
            const nseg = b[p + 26]; let d = p + 27 + nseg;
            for (let i = 0; i < nseg && packets.length < 2; i++) {
                const seg = b[p + 27 + i];
                cur.push(b.subarray(d, d + seg)); d += seg;
                if (seg < 255) {
                    const total = cur.reduce((a, c) => a + c.length, 0), pk = new Uint8Array(total); let o = 0;
                    for (const c of cur) { pk.set(c, o); o += c.length; }
                    packets.push(pk); cur = [];
                }
            }
            p = d;
        }
        const pk = packets[1]; if (!pk) return null;
        const out = {};
        if (pk[0] === 3 && ascii(pk, 1, 7) === "vorbis") parseVorbisComments(pk, 7, out);
        else if (ascii(pk, 0, 8) === "OpusTags") parseVorbisComments(pk, 8, out);
        return out;
    }

    // ── WAV ──
    async function readWav(file) {
        const out = {}; let p = 12;
        for (let guard = 0; guard < 64 && p + 8 <= file.size; guard++) {
            const h = await bytes(file, p, p + 12);
            const id = ascii(h, 0, 4), size = u32le(h, 4);
            if (id === "LIST" && ascii(h, 8, 12) === "INFO") {
                const body = await bytes(file, p + 12, p + 8 + size); let q = 0;
                while (q + 8 <= body.length) {
                    const sid = ascii(body, q, q + 4), ssz = u32le(body, q + 4);
                    const val = clean(TD.latin1.decode(body.subarray(q + 8, q + 8 + ssz)));
                    if (sid === "INAM" && !out.title) out.title = val;
                    else if (sid === "IART" && !out.artist) out.artist = val;
                    else if (sid === "IPRD" && !out.album) out.album = val;
                    q += 8 + ssz + (ssz & 1);
                }
            } else if (id.toLowerCase() === "id3 ") {
                const t = await readId3v2(file, p + 8);
                if (t) for (const k in t) if (!out[k]) out[k] = t[k];
            }
            p += 8 + size + (size & 1);
        }
        return out;
    }

    // "01 - Artist - Title.mp3" -> { artist, title }
    function fromFileName(name) {
        let base = String(name || "").replace(/\.[^.]+$/, "").replace(/_/g, " ").trim();
        base = base.replace(/^\d{1,3}\s*[-.)]\s*/, "");
        const parts = base.split(/\s+[-–—]\s+/);
        if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
        return { title: base };
    }

    async function read(file) {
        let tags = null;
        try {
            const h = await bytes(file, 0, 16);
            const magic = ascii(h, 0, 4);
            if (ascii(h, 0, 3) === "ID3") tags = await readId3v2(file, 0);
            else if (ascii(h, 4, 8) === "ftyp") tags = await readMp4(file);
            else if (magic === "fLaC") tags = await readFlac(file);
            else if (magic === "OggS") tags = await readOgg(file);
            else if (magic === "RIFF" && ascii(h, 8, 12) === "WAVE") tags = await readWav(file);
            if ((!tags || !tags.title || !tags.artist) && /\.(mp3|mp2|aac)$/i.test(file.name || "")) {
                const v1 = await readId3v1(file);
                if (v1) tags = Object.assign({}, v1, tags || {});
            }
        } catch (e) { console.warn("Tag read failed for", file && file.name, e); }
        tags = tags || {};
        const guess = fromFileName(file && file.name);
        const title = clean(tags.title) || guess.title || "Untitled";
        const artist = clean(tags.artist) || clean(tags.albumArtist) || guess.artist || "";
        let picture = null;
        if (tags._pic && tags._pic.length) picture = new Blob([tags._pic], { type: tags._picMime || "image/jpeg" });
        return { title, artist, album: clean(tags.album), year: clean(tags.year).slice(0, 4), track: clean(tags.track), picture };
    }

    window.SpootifyTags = { read, fromFileName };
})();
