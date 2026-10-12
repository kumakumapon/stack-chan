"""Local-only Japanese STT. Model download is a separate, explicit setup step."""

import argparse
import io
import json
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


def validate_wav(body: bytes) -> None:
    with wave.open(io.BytesIO(body), "rb") as audio:
        if (audio.getnchannels() != 1 or audio.getsampwidth() != 2
                or audio.getframerate() != 16000 or audio.getnframes() > 16000 * 30):
            raise ValueError("Expected at most 30 seconds of mono PCM16 at 16 kHz")


def create_handler(model: Any) -> type[BaseHTTPRequestHandler]:
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args: Any) -> None:
            # Never log audio, transcripts, or URL query strings.
            pass

        def reply(self, status: int, value: dict[str, Any]) -> None:
            body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self) -> None:
            self.reply(200 if self.path == "/health" else 404,
                       {"ready": True, "language": "ja"} if self.path == "/health" else {"error": "not-found"})

        def do_POST(self) -> None:
            if self.path != "/transcribe":
                self.reply(404, {"error": "not-found"})
                return
            if self.headers.get("Origin"):
                self.reply(403, {"error": "origin-not-allowed"})
                return
            try:
                self.connection.settimeout(15)
                length = int(self.headers.get("Content-Length", "0"))
                if not 44 <= length <= 1000000 or self.headers.get("Content-Type") != "audio/wav":
                    self.reply(400, {"error": "invalid-audio"})
                    return
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError("Incomplete audio")
                validate_wav(body)
                if not lock.acquire(blocking=False):
                    self.reply(429, {"error": "busy"})
                    return
                try:
                    segments, _info = model.transcribe(io.BytesIO(body), language="ja", beam_size=1,
                                                      condition_on_previous_text=False, vad_filter=False)
                    text = "".join(segment.text for segment in segments).strip()
                finally:
                    lock.release()
                self.reply(200, {"text": text})
            except (ValueError, wave.Error, EOFError, TimeoutError):
                self.reply(400, {"error": "invalid-audio"})
            except Exception:
                self.reply(500, {"error": "transcription-failed"})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    if not args.model.is_dir():
        raise SystemExit("Local model missing. Run Setup-Speech.cmd first.")
    from faster_whisper import WhisperModel

    model = WhisperModel(str(args.model.resolve()), device="cpu", compute_type="int8",
                         cpu_threads=4, local_files_only=True)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), create_handler(model))
    print("[speech] Japanese local STT ready", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
