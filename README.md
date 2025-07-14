# Audiobook Voice Assistant Prototype

This is a minimal, proof-of-concept voice assistant that helps audiobook readers stay hands-free while reading.  
With a single command you can:

1. Ask vocabulary questions (e.g. “Define *perspicacious*”).  
2. Request deeper explanations about a topic in the book.  
3. Dictate notes that are automatically transcribed and saved per-book.

The assistant relies on the OpenAI **Whisper** model for speech-to-text, OpenAI **Chat Completions** for reasoning, and OpenAI **TTS** for talking back to you.

---

## Quick Start

1. **Clone & enter the project**
   ```bash
   git clone <your-fork> audiobook-voice-assistant
   cd audiobook-voice-assistant
   ```
2. **Install Python deps (Python ≥ 3.9)**
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
3. **Set your API key**
   ```bash
   export OPENAI_API_KEY="sk-…"
   ```
   (or create a `.env` file with the same line.)
4. **Run the assistant**
   ```bash
   python voice_assistant.py
   ```

---

## Using the Assistant

• After launch you’ll be prompted for the **book title**. Notes are stored under `notes/<title>.txt`.  
• Press **Enter** to start speaking, then press **Enter** again to stop.  
• Say **“note …”**, **“take a note …”** or **“record note …”** to store a note instead of asking a question.  
• Type **q** and hit *Enter* at the prompt to quit.

---

## Configuration

All tweakable settings live in `config.json`:

```json
{
  "model": "gpt-4o-mini",
  "voice": "alloy",
  "assistant_prompt": "You are a helpful AI voice assistant for audiobook readers …"
}
```

Field reference:

* **model** – Any Chat Completion model name (e.g. `gpt-4o`, `gpt-4o-mini`, `gpt-3.5-turbo`).  
* **voice** – One of the supported TTS voices (e.g. `alloy`, `echo`, `fable`, …).  
* **assistant_prompt** – System prompt that defines your assistant’s persona. Feel free to rewrite!

---

## How It Works (High-level)

1. **Recording** – Uses `sounddevice` to capture microphone input (16 kHz mono WAV).
2. **Transcription** – Sends audio to `openai.audio.transcriptions.create` (Whisper-1).
3. **Reasoning** – Adds transcript to the ongoing conversation and calls Chat Completions.
4. **Speech** – Converts the assistant reply to audio via `openai.audio.speech.create`.
5. **Playback** – Streams the WAV back through the default audio output using `simpleaudio`.
6. **Notes** – When a command starts with a note trigger, the text (after the trigger) is timestamped and appended to `notes/<book>.txt`.

---

## Limitations & Future Ideas

* **Hands-free trigger** – Replace the *Enter* key with keyword wake-word detection.
* **Silence detection** – Auto-stop recording when the user stops speaking.
* **Streaming TTS** – Support low-latency audio streaming rather than waiting for the whole response.
* **Better note parsing** – Use function calling / JSON mode to structure notes.

Pull requests welcome! 

## GitHub Pages / Web Prototype

In addition to the Python CLI, a **browser-based version** lives under `docs/`.  Push `docs/` to your `main` branch and enable **GitHub Pages → Source: _Deploy from a branch_ → _/docs folder_**. You’ll get a public URL like:

```
https://<username>.github.io/<repo>/
```

### Using the Web Assistant

1. Open the page and grant microphone permission.
2. Click “Enable Assistant.”  
3. When you say the wake word **“Hey Bookbot”** followed by your request, the assistant records until you stop speaking (silence ≈ 1.2 s).  
4. The assistant replies audibly, and any commands starting with “note …” are stored in the Notes pane (downloadable as a text file).

The web client uses the same `config.json` for model, voice, prompt, and wake word. Edit it to experiment with different voices or personalities.

--- 

### Adjusting API Key & Wake Word (Web)

Open the **Settings** accordion at the top of the page:

* Paste or replace your **OpenAI API Key** (stored in the browser’s localStorage).  
* Type any custom **wake word** (case-insensitive).  
* Click **Save Settings**.  

Changes take effect immediately—no reload or redeploy needed.

--- 