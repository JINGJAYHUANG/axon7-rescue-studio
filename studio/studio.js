(function () {
  "use strict";

  const PRO_KEY_RE = /^AXON7-PRO-([A-Z0-9_]+)-([A-Z0-9]{8})-([A-F0-9]{4})-([a-f0-9]{16})$/;

  // Standard IEEE 802.3 CRC32 matching Python zlib.crc32 for offline deterministic preview unlock
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32Hex4(str) {
    let crc = 0xffffffff;
    for (let i = 0; i < str.length; i++) {
      crc = CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
    }
    return (((crc ^ 0xffffffff) >>> 0) & 0xffff).toString(16).toUpperCase().padStart(4, "0");
  }

  function verifyProKeyStructure(rawKey) {
    const cleaned = String(rawKey || "").trim();
    const m = PRO_KEY_RE.exec(cleaned);
    if (!m) {
      return { valid: false, reason: "Expected format AXON7-PRO-<SKU>-<ORD8>-<CHK4>-<HMAC16>" };
    }
    const [, skuTag, orderTag, chk4] = m;
    const expectedChk = crc32Hex4(`AXON7-PRO-${skuTag}-${orderTag}`);
    if (chk4 !== expectedChk) {
      return { valid: false, reason: "License checksum mismatch" };
    }
    return { valid: true, tier: "PRO", sku: skuTag, offline_verified: true };
  }

  function parseCubeText(cubeText) {
    const lines = String(cubeText || "").split(/\r?\n/);
    let size = 0;
    const triples = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("TITLE") || line.startsWith("DOMAIN_")) continue;
      if (line.startsWith("LUT_3D_SIZE")) {
        size = parseInt(line.split(/\s+/)[1], 10) || 0;
        continue;
      }
      const p = line.split(/\s+/);
      if (p.length >= 3) {
        const r = Number(p[0]);
        const g = Number(p[1]);
        const b = Number(p[2]);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
          triples.push([r, g, b]);
        }
      }
    }
    if (!size || triples.length < size * size * size) return null;
    const total = size * size * size;
    const rgba = new Uint8Array(total * 4);
    for (let i = 0; i < total; i++) {
      const [r, g, b] = triples[i];
      rgba[i * 4] = Math.max(0, Math.min(255, Math.round(r * 255)));
      rgba[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      rgba[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      rgba[i * 4 + 3] = 255;
    }
    return { size, data: rgba };
  }

  function buildFallbackLut(name) {
    const size = 17;
    const data = new Uint8Array(size * size * size * 4);
    let idx = 0;
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          let nr = r / (size - 1);
          let ng = g / (size - 1);
          let nb = b / (size - 1);
          if (name.includes("Cyber") || name.includes("Neon")) {
            nr = Math.pow(nr, 1.07);
            nb = Math.min(1, Math.pow(nb, 0.94) * 1.05);
          } else if (name.includes("Warm")) {
            nr = Math.min(1, nr * 1.09);
            nb = Math.max(0, nb * 0.9);
          }
          data[idx++] = Math.round(nr * 255);
          data[idx++] = Math.round(ng * 255);
          data[idx++] = Math.round(nb * 255);
          data[idx++] = 255;
        }
      }
    }
    return { size, data };
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initStudio() {
    if (typeof document === "undefined") return;

    const video = document.getElementById("source-video");
    const glCanvas = document.getElementById("gl-canvas");
    const studioCanvas = document.getElementById("studio-canvas");
    if (!video || !glCanvas || !studioCanvas) return;
    const compCtx = studioCanvas.getContext("2d");

    if (window.location.protocol === "file:") {
      const backLink = document.getElementById("back-portal-link");
      if (backLink) backLink.href = "../site/index.html";
    }

    const state = {
      lutName: "CyberTealOLED",
      lutMix: 0.85,
      contrast: 1.22,
      saturation: 1.18,
      sharpen: 0.55,
      zoom: 1.08,
      panX: 0.0,
      wipePct: 50,
      audioMastered: true,
      proUnlocked: false,
      currentFile: null,
      exporting: false,
    };

    // WebGL2 Pipeline
    const gl = glCanvas.getContext("webgl2", { preserveDrawingBuffer: true, alpha: false });
    let glProgram = null;
    let videoTex = null;
    let lutTex = null;
    let vao = null;
    const uniforms = {};

    const VERT_SRC = `#version 300 es
      in vec2 aPos;
      out vec2 vUv;
      void main() {
        vUv = aPos * 0.5 + 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }`;

    const FRAG_SRC = `#version 300 es
      precision highp float;
      precision highp sampler3D;
      in vec2 vUv;
      out vec4 fragColor;

      uniform sampler2D uVideoTex;
      uniform sampler3D uLutTex;
      uniform vec2 uVideoDim;
      uniform vec2 uOutDim;
      uniform vec2 uTexel;
      uniform float uZoom;
      uniform float uPanX;
      uniform float uContrast;
      uniform float uSat;
      uniform float uSharp;
      uniform float uLutMix;
      uniform float uWipeX;

      vec2 cropUv(vec2 uv) {
        vec2 c = vec2(uv.x, 1.0 - uv.y);
        float srcAsp = max(0.01, uVideoDim.x / max(1.0, uVideoDim.y));
        float dstAsp = max(0.01, uOutDim.x / max(1.0, uOutDim.y));
        vec2 sc = vec2(1.0);
        if (srcAsp > dstAsp) sc.x = dstAsp / srcAsp;
        else sc.y = srcAsp / dstAsp;
        sc /= max(1.0, uZoom);
        vec2 off = vec2((1.0 - sc.x) * clamp(0.5 + uPanX, 0.0, 1.0), (1.0 - sc.y) * 0.5);
        return clamp(c * sc + off, 0.0, 1.0);
      }

      void main() {
        vec2 uv = cropUv(vUv);
        vec3 raw = texture(uVideoTex, uv).rgb;
        if (vUv.x < uWipeX) {
          fragColor = vec4(raw, 1.0);
          return;
        }
        vec3 blur = (
          texture(uVideoTex, uv + vec2(uTexel.x, 0.0)).rgb +
          texture(uVideoTex, uv - vec2(uTexel.x, 0.0)).rgb +
          texture(uVideoTex, uv + vec2(0.0, uTexel.y)).rgb +
          texture(uVideoTex, uv - vec2(0.0, uTexel.y)).rgb
        ) * 0.25;
        vec3 sharp = clamp(raw + (raw - blur) * (uSharp * 1.5), 0.0, 1.0);
        vec3 con = clamp((sharp - 0.5) * uContrast + 0.5, 0.0, 1.0);
        float luma = dot(con, vec3(0.2126, 0.7152, 0.0722));
        vec3 sat = clamp(mix(vec3(luma), con, uSat), 0.0, 1.0);
        vec3 graded = texture(uLutTex, sat).rgb;
        fragColor = vec4(mix(sat, graded, uLutMix), 1.0);
      }`;

    function compileShader(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) || "Shader compile error");
      }
      return sh;
    }

    function uploadLut(lutObj) {
      if (!gl || !lutTex || !lutObj) return;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTex);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, lutObj.size, lutObj.size, lutObj.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutObj.data);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    }

    if (gl) {
      const vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
      const fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
      glProgram = gl.createProgram();
      gl.attachShader(glProgram, vs);
      gl.attachShader(glProgram, fs);
      gl.linkProgram(glProgram);
      gl.useProgram(glProgram);

      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(glProgram, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      videoTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      lutTex = gl.createTexture();
      for (const n of [
        "uVideoTex", "uLutTex", "uVideoDim", "uOutDim", "uTexel",
        "uZoom", "uPanX", "uContrast", "uSat", "uSharp", "uLutMix", "uWipeX",
      ]) {
        uniforms[n] = gl.getUniformLocation(glProgram, n);
      }
      gl.uniform1i(uniforms.uVideoTex, 0);
      gl.uniform1i(uniforms.uLutTex, 1);
    }

    // Load bundled .cube 3D LUTs
    const lutMap = {};
    const bundled = window.__AXON7_LUTS_BUNDLE__ || {};
    for (const [k, txt] of Object.entries(bundled)) {
      const parsed = parseCubeText(txt);
      if (parsed) lutMap[k] = parsed;
    }

    const lutSelect = document.getElementById("lut-select");
    if (lutSelect) {
      const bundledNames = Object.keys(lutMap);
      if (bundledNames.length) {
        lutSelect.innerHTML = bundledNames
          .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)} (.cube 3D)</option>`)
          .join("");
      }
      const getLut = (name) => lutMap[name] || buildFallbackLut(name);
      state.lutName = lutSelect.value || "CyberTealOLED";
      uploadLut(getLut(state.lutName));
      lutSelect.addEventListener("change", () => {
        state.lutName = lutSelect.value;
        uploadLut(getLut(state.lutName));
      });

      document.getElementById("cube-input")?.addEventListener("change", async (ev) => {
        const f = ev.target?.files?.[0];
        if (!f) return;
        const txt = await f.text();
        const parsed = parseCubeText(txt);
        if (!parsed) return;
        const customName = f.name.replace(/\.cube$/i, "");
        lutMap[customName] = parsed;
        const opt = document.createElement("option");
        opt.value = customName;
        opt.textContent = `${customName} (Custom .cube)`;
        lutSelect.appendChild(opt);
        lutSelect.value = customName;
        state.lutName = customName;
        uploadLut(parsed);
      });
    }

    // WebAudio Broadcast Mastering Chain
    let audioCtx = null;
    let dryGain = null;
    let wetGain = null;
    let analyser = null;
    let streamDest = null;

    function ensureAudio() {
      if (audioCtx) {
        if (audioCtx.state === "suspended") audioCtx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      const src = audioCtx.createMediaElementSource(video);
      dryGain = audioCtx.createGain();
      wetGain = audioCtx.createGain();

      const hpf = audioCtx.createBiquadFilter();
      hpf.type = "highpass";
      hpf.frequency.value = 80;

      const presence = audioCtx.createBiquadFilter();
      presence.type = "peaking";
      presence.frequency.value = 3500;
      presence.Q.value = 1.1;
      presence.gain.value = 4.5;

      const comp = audioCtx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.14;

      const makeup = audioCtx.createGain();
      makeup.gain.value = 1.38;

      const sum = audioCtx.createGain();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      streamDest = audioCtx.createMediaStreamDestination();

      src.connect(dryGain);
      dryGain.connect(sum);

      src.connect(hpf);
      hpf.connect(presence);
      presence.connect(comp);
      comp.connect(makeup);
      makeup.connect(wetGain);
      wetGain.connect(sum);

      sum.connect(analyser);
      analyser.connect(audioCtx.destination);
      sum.connect(streamDest);
      syncAudioMode();
    }

    function syncAudioMode() {
      if (!dryGain || !wetGain) return;
      dryGain.gain.value = state.audioMastered ? 0.0 : 1.0;
      wetGain.gain.value = state.audioMastered ? 1.0 : 0.0;
    }

    // Sliders & Controls
    const bindRange = (id, key, valId, fmt) => {
      const el = document.getElementById(id);
      const val = document.getElementById(valId);
      if (!el) return;
      el.addEventListener("input", () => {
        state[key] = Number(el.value);
        if (val) val.textContent = fmt(state[key]);
        if (key === "wipePct") syncWipeUi();
      });
    };
    bindRange("lut-mix", "lutMix", "val-lut-mix", (v) => `${Math.round(v * 100)}%`);
    bindRange("ctrl-contrast", "contrast", "val-contrast", (v) => v.toFixed(2));
    bindRange("ctrl-sat", "saturation", "val-sat", (v) => v.toFixed(2));
    bindRange("ctrl-sharp", "sharpen", "val-sharp", (v) => v.toFixed(2));
    bindRange("ctrl-zoom", "zoom", "val-zoom", (v) => `${v.toFixed(2)}x`);
    bindRange("ctrl-pan", "panX", null, (v) => String(v));
    bindRange("ctrl-wipe", "wipePct", "val-wipe", (v) => `${Math.round(v)}%`);

    const wipeStage = document.getElementById("wipe-stage");
    const wipeLine = document.getElementById("wipe-line");
    const wipeHandle = document.getElementById("wipe-handle");
    const wipeInput = document.getElementById("ctrl-wipe");
    const wipeVal = document.getElementById("val-wipe");

    function syncWipeUi() {
      const pct = `${Math.max(0, Math.min(100, state.wipePct)).toFixed(1)}%`;
      if (wipeLine) wipeLine.style.left = pct;
      if (wipeHandle) wipeHandle.style.left = pct;
      if (wipeInput) wipeInput.value = String(Math.round(state.wipePct));
      if (wipeVal) wipeVal.textContent = `${Math.round(state.wipePct)}%`;
    }

    if (wipeStage) {
      let dragging = false;
      const moveWipe = (clientX) => {
        const rect = wipeStage.getBoundingClientRect();
        const frac = Math.max(0.02, Math.min(0.98, (clientX - rect.left) / Math.max(1, rect.width)));
        state.wipePct = frac * 100;
        syncWipeUi();
      };
      wipeStage.addEventListener("pointerdown", (ev) => {
        dragging = true;
        wipeStage.setPointerCapture(ev.pointerId);
        moveWipe(ev.clientX);
      });
      wipeStage.addEventListener("pointermove", (ev) => {
        if (dragging) moveWipe(ev.clientX);
      });
      wipeStage.addEventListener("pointerup", () => {
        dragging = false;
      });
    }

    document.getElementById("audio-ab-btn")?.addEventListener("click", () => {
      ensureAudio();
      state.audioMastered = !state.audioMastered;
      syncAudioMode();
      const modeLabel = document.getElementById("val-audio-mode");
      if (modeLabel) modeLabel.textContent = state.audioMastered ? "MASTERED" : "BYPASS (RAW)";
    });

    document.getElementById("play-pause-btn")?.addEventListener("click", () => {
      ensureAudio();
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });

    // Source Input (Drag & Drop + File Picker + 1-Click Sample)
    const srcStatus = document.getElementById("source-status");
    const loadSource = (url, label, fileObj) => {
      state.currentFile = fileObj || null;
      video.src = url;
      video.load();
      video.addEventListener(
        "canplay",
        () => {
          ensureAudio();
          video.play().catch(() => {});
          if (srcStatus) {
            srcStatus.textContent = `Loaded: ${label} (${video.videoWidth}x${video.videoHeight})`;
          }
        },
        { once: true }
      );
    };

    const fileInput = document.getElementById("file-input");
    const dropzone = document.getElementById("dropzone");
    document.getElementById("pick-file-btn")?.addEventListener("click", () => fileInput?.click());
    dropzone?.addEventListener("click", () => fileInput?.click());
    dropzone?.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    });
    dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
      const f = e.dataTransfer?.files?.[0];
      if (f) loadSource(URL.createObjectURL(f), f.name, f);
    });
    fileInput?.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) loadSource(URL.createObjectURL(f), f.name, f);
    });

    document.getElementById("load-sample-btn")?.addEventListener("click", () => {
      const ext = ["m", "p", "4"].join("");
      loadSource(`sample/axon7_sample_clip.${ext}`, "AXON-7 Sample Demo Clip", null);
    });

    // Render Loop
    const capToggle = document.getElementById("toggle-captions");
    const capText = document.getElementById("caption-text");
    const meterFill = document.getElementById("audio-meter-fill");

    function renderLoop() {
      const w = glCanvas.width;
      const h = glCanvas.height;
      if (gl && glProgram && video.readyState >= 2) {
        gl.viewport(0, 0, w, h);
        gl.useProgram(glProgram);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, videoTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.uniform2f(uniforms.uVideoDim, video.videoWidth || 720, video.videoHeight || 1280);
        gl.uniform2f(uniforms.uOutDim, w, h);
        gl.uniform2f(uniforms.uTexel, 1 / (video.videoWidth || 720), 1 / (video.videoHeight || 1280));
        gl.uniform1f(uniforms.uZoom, state.zoom);
        gl.uniform1f(uniforms.uPanX, state.panX);
        gl.uniform1f(uniforms.uContrast, state.contrast);
        gl.uniform1f(uniforms.uSat, state.saturation);
        gl.uniform1f(uniforms.uSharp, state.sharpen);
        gl.uniform1f(uniforms.uLutMix, state.lutMix);
        gl.uniform1f(uniforms.uWipeX, state.wipePct / 100);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        compCtx.drawImage(glCanvas, 0, 0, studioCanvas.width, studioCanvas.height);
      } else {
        compCtx.fillStyle = "#04060a";
        compCtx.fillRect(0, 0, studioCanvas.width, studioCanvas.height);
        compCtx.fillStyle = "#8ea6c2";
        compCtx.font = "600 24px sans-serif";
        compCtx.textAlign = "center";
        compCtx.fillText("CLICK 1-CLICK SAMPLE DEMO OR DROP MP4", studioCanvas.width / 2, studioCanvas.height / 2);
      }

      // Kinetic word-pop caption overlay
      if (capToggle?.checked && capText?.value.trim()) {
        const words = capText.value.trim().split(/\s+/);
        const wordIdx = Math.floor((video.currentTime || 0) * 2.8) % Math.max(1, words.length);
        const start = Math.floor(wordIdx / 3) * 3;
        const phrase = words.slice(start, start + 3).join(" ").toUpperCase();
        const boxW = studioCanvas.width * 0.84;
        const boxY = studioCanvas.height * 0.78;
        compCtx.save();
        compCtx.fillStyle = "rgba(4, 6, 9, 0.78)";
        compCtx.strokeStyle = "rgba(0, 229, 255, 0.75)";
        compCtx.lineWidth = 3;
        compCtx.beginPath();
        compCtx.roundRect((studioCanvas.width - boxW) / 2, boxY - 38, boxW, 74, 12);
        compCtx.fill();
        compCtx.stroke();
        compCtx.font = `800 ${Math.round(studioCanvas.width * 0.048)}px sans-serif`;
        compCtx.textAlign = "center";
        compCtx.textBaseline = "middle";
        compCtx.fillStyle = "#00ff9d";
        compCtx.fillText(phrase, studioCanvas.width / 2, boxY);
        compCtx.restore();
      }

      if (!state.proUnlocked) {
        compCtx.save();
        compCtx.fillStyle = "rgba(4, 6, 9, 0.68)";
        compCtx.fillRect(0, studioCanvas.height - 44, studioCanvas.width, 44);
        compCtx.fillStyle = "#ffb020";
        compCtx.font = `700 ${Math.round(studioCanvas.width * 0.025)}px monospace`;
        compCtx.textAlign = "center";
        compCtx.fillText("AXON-7 FREE 720P PREVIEW • UNLOCK PRO 1080P60", studioCanvas.width / 2, studioCanvas.height - 16);
        compCtx.restore();
      }

      if (meterFill && analyser) {
        const bins = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);
        const avg = bins.reduce((a, b) => a + b, 0) / Math.max(1, bins.length);
        meterFill.style.width = `${Math.min(100, Math.round((avg / 180) * 100))}%`;
      }

      requestAnimationFrame(renderLoop);
    }
    requestAnimationFrame(renderLoop);

    // MediaRecorder Export
    const exportBtn = document.getElementById("export-btn");
    const dlLink = document.getElementById("download-export-link");
    const exportStatus = document.getElementById("export-status");
    if (exportBtn) {
      exportBtn.addEventListener("click", async () => {
        if (state.exporting) return;
        if (!video.src || video.readyState < 2) {
          if (exportStatus) exportStatus.textContent = "Load a clip or sample first before exporting.";
          return;
        }
        ensureAudio();
        state.exporting = true;
        const w = state.proUnlocked ? 1080 : 720;
        const h = state.proUnlocked ? 1920 : 1280;
        const fps = state.proUnlocked ? 60 : 30;
        glCanvas.width = w;
        glCanvas.height = h;
        studioCanvas.width = w;
        studioCanvas.height = h;

        const stream = studioCanvas.captureStream(fps);
        if (streamDest) {
          streamDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        }
        const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : "video/webm";
        const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: state.proUnlocked ? 8_000_000 : 3_000_000 });
        const chunks = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: "video/webm" });
          const dlUrl = URL.createObjectURL(blob);
          const outName = state.proUnlocked ? "axon7-master-1080p60.webm" : "axon7-preview-720p.webm";
          if (dlLink) {
            dlLink.href = dlUrl;
            dlLink.download = outName;
            dlLink.style.display = "inline-flex";
          }
          glCanvas.width = 720;
          glCanvas.height = 1280;
          studioCanvas.width = 720;
          studioCanvas.height = 1280;
          state.exporting = false;
          if (exportStatus) exportStatus.textContent = `Ready: ${outName} (${(blob.size / 1024).toFixed(1)} KB)`;
        };

        video.currentTime = 0;
        await video.play().catch(() => {});
        const ms = Math.min(12000, Math.max(2500, Math.round((video.duration || 4.5) * 1000)));
        recorder.start(250);
        if (exportStatus) exportStatus.textContent = `Recording ${w}x${h} @ ${fps}fps (${(ms / 1000).toFixed(1)}s)...`;
        setTimeout(() => {
          if (recorder.state !== "inactive") recorder.stop();
        }, ms);
      });
    }

    // License Unlock
    const tierBadge = document.getElementById("tier-badge");
    const licInput = document.getElementById("license-key-input");
    const licStatus = document.getElementById("license-status");

    document.getElementById("verify-license-btn")?.addEventListener("click", async () => {
      const key = (licInput?.value || "").trim();
      if (!key) {
        if (licStatus) licStatus.textContent = "Enter an AXON7-PRO license key first.";
        return;
      }
      let res = verifyProKeyStructure(key);
      if (window.location.protocol.startsWith("http")) {
        try {
          const resp = await fetch("/api/verify-license", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ license_key: key }),
          });
          if (resp.ok) res = await resp.json();
        } catch (_err) {
          // Offline checksum remains valid for standalone static hosting
        }
      }
      if (res.valid) {
        state.proUnlocked = true;
        if (tierBadge) {
          tierBadge.className = "badge ok";
          tierBadge.textContent = `PRO 1080P60 UNLOCKED (${res.tier || "PRO"})`;
        }
        if (licStatus) licStatus.textContent = "Unlocked: Unwatermarked 1080p60 WebM export active.";
      } else {
        state.proUnlocked = false;
        if (licStatus) licStatus.textContent = `Rejected: ${res.reason || "Invalid key"}`;
      }
    });

    // Server M5 Metal Backend Rescue (POST /api/rescue-clip)
    const srvStatus = document.getElementById("server-rescue-status");
    const srvPlayer = document.getElementById("server-rescue-player");
    document.getElementById("server-rescue-btn")?.addEventListener("click", async () => {
      if (!window.location.protocol.startsWith("http")) {
        if (srvStatus) srvStatus.textContent = "Connect via http://127.0.0.1:8707/studio to run M5 rescue.";
        return;
      }
      if (srvStatus) srvStatus.textContent = "Running FrameForge M5 --fast-web rescue...";
      try {
        let resp;
        if (state.currentFile) {
          const fd = new FormData();
          fd.append("file", state.currentFile);
          resp = await fetch("/api/rescue-clip", { method: "POST", body: fd });
        } else {
          resp = await fetch("/api/rescue-clip", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clip_id: "raw_01" }),
          });
        }
        const payload = await resp.json();
        if (!resp.ok) throw new Error(payload.detail || `HTTP ${resp.status}`);
        if (srvPlayer && payload.preview_url) {
          srvPlayer.src = payload.preview_url;
          srvPlayer.style.display = "block";
        }
        if (srvStatus) {
          srvStatus.textContent = `M5 Rescue ready: ${payload.preview_url} (${payload.engine || "m5"})`;
        }
      } catch (err) {
        if (srvStatus) srvStatus.textContent = `M5 API error: ${err.message}`;
      }
    });

    // Checkout Modal driven by LAUNCH_IGNITION.json
    const modal = document.getElementById("checkout-modal");
    const railBadge = document.getElementById("rail-badge");
    const prodList = document.getElementById("checkout-products-list");
    document.getElementById("open-checkout-btn")?.addEventListener("click", () => modal?.classList.add("open"));
    document.getElementById("close-checkout-btn")?.addEventListener("click", () => modal?.classList.remove("open"));

    fetch("launch_ignition.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (!cfg) return;
        const status = cfg.rail_status || "DIRECT_INVOICE_ACTIVE";
        if (railBadge) {
          railBadge.className = `badge ${(status === "PAYOUT_RAILS_CONFIGURED" || status === "DIRECT_INVOICE_ACTIVE") ? "ok" : "warn"}`;
          railBadge.textContent = status;
        }
        if (prodList && Array.isArray(cfg.products)) {
          const links = cfg.checkout_links || {};
          prodList.innerHTML = cfg.products
            .map((p) => {
              const url = links[p.checkout_key];
              const cta = url
                ? `<a class="btn btn-green" href="${escapeHtml(url)}" target="_blank" rel="noopener">${url.startsWith("mailto:") ? "Order / Invoice" : "Checkout"} $${Number(p.price_usd).toFixed(0)}</a>`
                : `<span class="badge warn">Configure Link</span>`;
              return `<div class="product-row"><div><strong>${escapeHtml(p.name)}</strong><div class="mono" style="font-size:0.72rem;color:var(--muted)">${escapeHtml(p.unlocks || "")}</div></div>${cta}</div>`;
            })
            .join("");
        }
      })
      .catch(() => {});
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", initStudio);
  }
})();
