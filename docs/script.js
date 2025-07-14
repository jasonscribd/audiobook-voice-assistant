// Audiobook Voice Assistant – Web Prototype
// Relies on OpenAI APIs from the browser.

(async () => {
  const statusEl = document.getElementById("status-text");
  const toggleBtn = document.getElementById("toggle-btn");
  const chatLog = document.getElementById("chat-log");
  const notesLog = document.getElementById("notes-log");
  const dlNotesBtn = document.getElementById("download-notes");
  const apiKeyInput = document.getElementById("api-key-input");
  const wakeWordInput = document.getElementById("wake-word-input");
  const saveSettingsBtn = document.getElementById("save-settings");

  let config = await fetch("config.json").then((r) => r.json());
  // We will compute WAKE_WORD after loading persisted settings

  // ------------------ Settings Persistence ------------------
  function loadSettings() {
    const storedKey = localStorage.getItem("OPENAI_API_KEY") || "";
    const storedWake = localStorage.getItem("WAKE_WORD") || config.wake_word;
    apiKeyInput.value = storedKey;
    wakeWordInput.value = storedWake;
    return { apiKey: storedKey, wakeWord: storedWake.toLowerCase() };
  }

  function saveSettings() {
    localStorage.setItem("OPENAI_API_KEY", apiKeyInput.value.trim());
    localStorage.setItem("WAKE_WORD", wakeWordInput.value.trim().toLowerCase());
    alert("Settings saved ✅");
  }

  saveSettingsBtn.addEventListener("click", saveSettings);

  let { apiKey, wakeWord } = loadSettings();
  const WAKE_WORD = wakeWord; // final wake word in lower case

  if (!apiKey) {
    statusEl.textContent = "Please enter API key in Settings.";
  }

  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("OPENAI_API_KEY")}` });

  let listening = false;
  let messages = [{ role: "system", content: config.assistant_prompt }];
  let notes = [];

  // Web Audio setup
  let audioCtx, analyserNode, mediaStream, mediaRecorder;
  const SILENCE_THRESHOLD = 0.02; // volume
  const SILENCE_MS = 1200; // end recording after this duration of silence

  let silenceStart = null;
  let chunks = [];

  // ------------------ TTS Status Helper ------------------
  async function speakStatus(text) {
    try {
      const ttsBody = {
        model: "tts-1",
        voice: config.voice,
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
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
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
    } catch (e) {
      console.error(e);
      statusEl.textContent = "Transcription error";
      return;
    }

    if (!transcriptText.toLowerCase().startsWith(WAKE_WORD)) {
      statusEl.textContent = "Wake word not detected. Listening…";
      return;
    }

    const userText = transcriptText.slice(WAKE_WORD.length).trim();
    await speakStatus("Listening…");
    appendChat("user", userText);

    let assistantReply = "";
    if (/^(note|take a note|record note)/i.test(userText)) {
      const noteContent = userText.replace(/^(note|take a note|record note)/i, "").trim();
      await speakStatus("Saving your note.");
      notes.push(noteContent);
      appendNote(noteContent);
      assistantReply = "Your note has been saved.";
    } else {
      await speakStatus("Looking that up.");
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
        messages.push({ role: "assistant", content: assistantReply });
      } catch (e) {
        console.error(e);
        statusEl.textContent = "Chat error";
        return;
      }
    }

    appendChat("assistant", assistantReply);

    // TTS
    statusEl.textContent = "Speaking…";
    const ttsBody = {
      model: "tts-1",
      voice: config.voice,
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
})(); 