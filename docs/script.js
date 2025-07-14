// Audiobook Voice Assistant – Web Prototype
// Relies on OpenAI APIs from the browser.

(async () => {
  const statusEl = document.getElementById("status-text");
  const toggleBtn = document.getElementById("toggle-btn");
  const chatLog = document.getElementById("chat-log");
  const notesLog = document.getElementById("notes-log");
  const dlNotesBtn = document.getElementById("download-notes");
  // Debug log elements
  const debugLogEl = document.getElementById("debug-log");
  const clearLogBtn = document.getElementById("clear-log");
  const downloadLogBtn = document.getElementById("download-log");
  const apiKeyInput = document.getElementById("api-key-input");
  const wakeWordInput = document.getElementById("wake-word-input");
  const voiceSelect = document.getElementById("voice-select");
  const promptInput = document.getElementById("prompt-input");
  const saveSettingsBtn = document.getElementById("save-settings");

  let config = await fetch("config.json").then((r) => r.json());
  // We will compute WAKE_WORD after loading persisted settings

  // ------------------ Settings Persistence ------------------
  function loadSettings() {
    const storedKey = localStorage.getItem("OPENAI_API_KEY") || "";
    const storedWake = localStorage.getItem("WAKE_WORD") || config.wake_word;
    const storedVoice = localStorage.getItem("VOICE") || config.voice;
    const storedPrompt = localStorage.getItem("ASSISTANT_PROMPT") || config.assistant_prompt;

    // populate fields
    apiKeyInput.value = storedKey;
    wakeWordInput.value = storedWake;
    voiceSelect.value = storedVoice;
    promptInput.value = storedPrompt;

    return {
      apiKey: storedKey,
      wakeWord: storedWake.toLowerCase(),
      voice: storedVoice,
      prompt: storedPrompt,
    };
  }

  function saveSettings() {
    localStorage.setItem("OPENAI_API_KEY", apiKeyInput.value.trim());
    localStorage.setItem("WAKE_WORD", wakeWordInput.value.trim().toLowerCase());
    localStorage.setItem("VOICE", voiceSelect.value);
    localStorage.setItem("ASSISTANT_PROMPT", promptInput.value.trim());

    // update in-memory vars without reload
    apiKey = apiKeyInput.value.trim();
    WAKE_WORD_CONST = wakeWordInput.value.trim().toLowerCase();
    voice = voiceSelect.value;
    assistantPrompt = promptInput.value.trim() || config.assistant_prompt;
    messages = [{ role: "system", content: assistantPrompt }];

    alert("Settings saved ✅");
  }

  saveSettingsBtn.addEventListener("click", saveSettings);

  let { apiKey, wakeWord, voice, prompt: assistantPrompt } = loadSettings();
  let WAKE_WORD_CONST = wakeWord; // mutable wake word variable

  if (!apiKey) {
    statusEl.textContent = "Please enter API key in Settings.";
  }

  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("OPENAI_API_KEY")}` });

  // helper to get current voice
  const getVoice = () => localStorage.getItem("VOICE") || voice || config.voice;

  let listening = false;
  let messages = [{ role: "system", content: assistantPrompt }];
  let notes = [];

  // Web Audio setup
  let audioCtx, analyserNode, mediaStream, mediaRecorder;
  const SILENCE_THRESHOLD = 0.05; // volume threshold for voice vs silence
  const SILENCE_MS = 1200; // end recording after this duration of silence

  let silenceStart = null;
  let chunks = [];

  // ------------------ TTS Status Helper ------------------
  async function speakStatus(text) {
    try {
      log("[speakStatus] " + text);
      const ttsBody = {
        model: "tts-1",
        voice: getVoice(),
        input: text,
        format: "wav",
      };
      const resp = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          ...headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ttsBody),
      });
      const arrayBuffer = await resp.arrayBuffer();
      const audioBlob = new Blob([arrayBuffer], { type: "audio/wav" });
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      await audio.play();
      await new Promise((res) => audio.addEventListener("ended", res, { once: true }));
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("speakStatus error", e);
    }
  }

  toggleBtn.addEventListener("click", async () => {
    if (!listening) {
      await startAssistant();
    } else {
      stopAssistant();
    }
  });

  dlNotesBtn.addEventListener("click", () => {
    const blob = new Blob([notes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "notes.txt";
    a.click();
    URL.revokeObjectURL(url);
  });

  async function startAssistant() {
    try {
      log("Requesting microphone access…");
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      log("Microphone access denied: " + err);
      alert("Microphone access denied.");
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;
    source.connect(analyserNode);

    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = handleRecordingStop;

    listening = true;
    toggleBtn.textContent = "Disable Assistant";
    statusEl.textContent = "Listening for wake word…";

    detectAudio();
  }

  function stopAssistant() {
    listening = false;
    toggleBtn.textContent = "Enable Assistant";
    statusEl.textContent = "Idle";
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
    }
    if (audioCtx) {
      audioCtx.close();
    }
  }

  function detectAudio() {
    if (!listening) return;
    const data = new Uint8Array(analyserNode.fftSize);
    analyserNode.getByteTimeDomainData(data);
    // Compute RMS
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const val = (data[i] - 128) / 128;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / data.length);

    const now = Date.now();

    if (mediaRecorder.state === "inactive" && rms > SILENCE_THRESHOLD) {
      // Start recording
      chunks = [];
      silenceStart = null;
      mediaRecorder.start();
      statusEl.textContent = "Recording…";
      log("Recording started");
    }

    if (mediaRecorder.state === "recording") {
      if (rms <= SILENCE_THRESHOLD) {
        if (silenceStart === null) silenceStart = now;
        if (now - silenceStart > SILENCE_MS) {
          mediaRecorder.stop();
        }
      } else {
        silenceStart = null; // reset – we got voice
      }
    }

    requestAnimationFrame(detectAudio);
  }

  async function handleRecordingStop() {
    statusEl.textContent = "Transcribing…";
    log("Recording stopped, sending transcription (" + (blob.size / 1024).toFixed(1) + " KB)");
    const blob = new Blob(chunks, { type: "audio/webm" });

    const formData = new FormData();
    formData.append("model", "whisper-1");
    formData.append("file", blob, "speech.webm");

    let transcriptText = "";
    try {
      const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: headers(),
        body: formData,
      });
      const json = await resp.json();
      transcriptText = json.text.trim();
      log("Transcript received: " + transcriptText);
    } catch (e) {
      console.error(e);
      statusEl.textContent = "Transcription error";
      log("Transcription error: " + e);
      return;
    }

    if (!transcriptText.toLowerCase().startsWith(WAKE_WORD_CONST)) {
      statusEl.textContent = "Wake word not detected. Listening…";
      log("Wake word missing – discarded transcript");
      return;
    }

    const userText = transcriptText.slice(WAKE_WORD_CONST.length).trim();
    await speakStatus("Listening…");
    appendChat("user", userText);

    let assistantReply = "";
    if (/^(note|take a note|record note)/i.test(userText)) {
      const noteContent = userText.replace(/^(note|take a note|record note)/i, "").trim();
      await speakStatus("Saving your note.");
      notes.push(noteContent);
      appendNote(noteContent);
      log("Note captured: " + noteContent);
      assistantReply = "Your note has been saved.";
    } else {
      await speakStatus("Looking that up.");
      log("Querying ChatGPT with: " + userText);
      messages.push({ role: "user", content: userText });
      statusEl.textContent = "Generating answer…";
      const chatBody = {
        model: config.model,
        messages,
      };
      try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            ...headers(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(chatBody),
        });
        const data = await resp.json();
        assistantReply = data.choices[0].message.content.trim();
        log("Assistant reply received");
        messages.push({ role: "assistant", content: assistantReply });
      } catch (e) {
        console.error(e);
        statusEl.textContent = "Chat error";
        log("Chat error: " + e);
        return;
      }
    }

    appendChat("assistant", assistantReply);

    // TTS
    statusEl.textContent = "Speaking…";
    const ttsBody = {
      model: "tts-1",
      voice: getVoice(),
      input: assistantReply,
      format: "wav",
    };
    try {
      const resp = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          ...headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ttsBody),
      });
      const arrayBuffer = await resp.arrayBuffer();
      const audioBlob = new Blob([arrayBuffer], { type: "audio/wav" });
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => {
        URL.revokeObjectURL(url);
        statusEl.textContent = "Listening for wake word…";
      };
    } catch (e) {
      console.error(e);
      statusEl.textContent = "TTS error";
      log("TTS error: " + e);
    }
  }

  function appendChat(role, text) {
    const p = document.createElement("p");
    p.className = role === "assistant" ? "assistant" : "user";
    p.textContent = `${role === "assistant" ? "Assistant" : "You"}: ${text}`;
    chatLog.appendChild(p);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function appendNote(text) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = text;
    notesLog.appendChild(p);
    notesLog.scrollTop = notesLog.scrollHeight;
  }

  // --------- Debug logging helper ---------
  function log(msg) {
    const ts = new Date().toLocaleTimeString();
    console.log(msg);
    if (debugLogEl) {
      debugLogEl.value += `[${ts}] ${msg}\n`;
      debugLogEl.scrollTop = debugLogEl.scrollHeight;
    }
  }

  if (clearLogBtn) {
    clearLogBtn.addEventListener("click", () => (debugLogEl.value = ""));
  }
  if (downloadLogBtn) {
    downloadLogBtn.addEventListener("click", () => {
      const blob = new Blob([debugLogEl.value], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "debug_log.txt";
      a.click();
      URL.revokeObjectURL(url);
    });
  }
})(); 