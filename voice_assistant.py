import json
import os
import queue
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import numpy as np
import openai
import sounddevice as sd
import soundfile as sf
import simpleaudio as sa
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

CONFIG_PATH = Path(__file__).parent / "config.json"
NOTES_DIR = Path(__file__).parent / "notes"
NOTES_DIR.mkdir(exist_ok=True)

# ------- Utility Functions ---------------------------------------------------

def load_config(path: Path):
    if not path.exists():
        print(f"Configuration file {path} not found.")
        sys.exit(1)
    with open(path, "r") as f:
        return json.load(f)


def record_audio(samplerate: int = 16000, channels: int = 1) -> Path:
    """Record audio until user presses Enter again and return path to WAV file."""
    print("Recording... Press Enter to stop.")
    q = queue.Queue()

    def callback(indata, frames, time, status):
        if status:
            print(status, file=sys.stderr)
        q.put(indata.copy())

    stream = sd.InputStream(samplerate=samplerate, channels=channels, dtype="int16", callback=callback)
    frames = []
    with stream:
        _ = input()  # Wait until user hits Enter
        while not q.empty():
            frames.append(q.get())
        # Small delay to flush remaining audio
        sd.sleep(300)
        while not q.empty():
            frames.append(q.get())
    audio_data = np.concatenate(frames, axis=0)
    # Save to temp WAV file
    tmp_wav = Path(tempfile.mkstemp(suffix=".wav")[1])
    sf.write(tmp_wav, audio_data, samplerate)
    return tmp_wav


def transcribe_audio(file_path: Path) -> str:
    """Transcribe audio file using Whisper."""
    with open(file_path, "rb") as f:
        transcript = openai.audio.transcriptions.create(model="whisper-1", file=f)
    return transcript.text.strip()


def chat_response(messages, model="gpt-4o-mini") -> str:
    response = openai.chat.completions.create(
        model=model,
        messages=messages,
    )
    return response.choices[0].message.content.strip()


def synthesize_speech(text: str, voice: str = "alloy", fmt: str = "wav") -> Path:
    resp = openai.audio.speech.create(
        model="tts-1",
        voice=voice,
        input=text,
        format=fmt,
    )
    audio_bytes = resp.audio.data
    tmp_audio = Path(tempfile.mkstemp(suffix=f".{fmt}")[1])
    with open(tmp_audio, "wb") as f:
        f.write(audio_bytes)
    return tmp_audio


def play_audio(wav_path: Path):
    wave_obj = sa.WaveObject.from_wave_file(str(wav_path))
    play_obj = wave_obj.play()
    play_obj.wait_done()


def save_note(book_title: str, note_text: str):
    filename = NOTES_DIR / f"{book_title.replace(' ', '_')}.txt"
    timestamp = datetime.now().isoformat(timespec="seconds")
    with open(filename, "a") as f:
        f.write(f"[{timestamp}] {note_text}\n")
    print(f"Note saved to {filename}")


# ------- Main interactive loop ----------------------------------------------

def main():
    config = load_config(CONFIG_PATH)

    openai.api_key = os.getenv("OPENAI_API_KEY")
    if not openai.api_key:
        print("OPENAI_API_KEY environment variable not set.")
        sys.exit(1)

    book_title = input("Enter book title: ") or "my_book"

    messages = [
        {"role": "system", "content": config["assistant_prompt"]},
    ]
    print("\nReady. Press Enter to talk, or type 'q' then Enter to quit.\n")

    while True:
        cmd = input("Press Enter to start recording (q to quit): ")
        if cmd.strip().lower() == "q":
            print("Goodbye!")
            break

        wav_path = record_audio()
        user_text = transcribe_audio(wav_path)
        print(f"You said: {user_text}")
        wav_path.unlink(missing_ok=True)  # cleanup

        lower_text = user_text.lower()
        if lower_text.startswith("note") or lower_text.startswith("take a note") or lower_text.startswith("record note"):
            # Extract note content after the trigger word
            note_content = user_text.split(" ", 1)[1] if " " in user_text else ""
            save_note(book_title, note_content)
            reply_text = "Your note has been saved."
        else:
            messages.append({"role": "user", "content": user_text})
            reply_text = chat_response(messages, model=config["model"])
            messages.append({"role": "assistant", "content": reply_text})

        print(f"Assistant: {reply_text}")
        audio_path = synthesize_speech(reply_text, voice=config["voice"], fmt="wav")
        play_audio(audio_path)
        audio_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted by user. Exiting...") 