// MP3 encoder worker for the audio trimmer (see AUDIO TRIMMER in app.v2.js).
// Receives { left, right, sampleRate, kbps } as Float32Arrays and streams back
// { progress } messages followed by { done, parts: Uint8Array[] }.
importScripts("lame.min.js");

self.onmessage = (e) => {
    try {
        const { left, right, sampleRate, kbps } = e.data;
        const channels = right ? 2 : 1;
        const enc = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
        const toInt16 = (f) => {
            const o = new Int16Array(f.length);
            for (let i = 0; i < f.length; i++) { const v = f[i] * 32767; o[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v; }
            return o;
        };
        const l = toInt16(left), r = right ? toInt16(right) : null;
        const block = 1152 * 20, parts = [];
        let n = 0;
        for (let i = 0; i < l.length; i += block) {
            const buf = channels === 2 ? enc.encodeBuffer(l.subarray(i, i + block), r.subarray(i, i + block)) : enc.encodeBuffer(l.subarray(i, i + block));
            if (buf.length) parts.push(new Uint8Array(buf));
            if (n++ % 8 === 0) self.postMessage({ progress: i / l.length });
        }
        const end = enc.flush();
        if (end.length) parts.push(new Uint8Array(end));
        self.postMessage({ done: true, parts }, parts.map((p) => p.buffer));
    } catch (err) {
        self.postMessage({ error: (err && err.message) || String(err) });
    }
};
