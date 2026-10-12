"""Behavior tests for the local HTTP contract, without a model download."""
import http.client
import io
import json
import threading
import unittest
import wave
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
from whisper_server import create_handler, validate_wav


def make_wav(channels: int = 1, rate: int = 16000) -> bytes:
    stream = io.BytesIO()
    with wave.open(stream, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b"\x00\x00" * channels * 320)
    return stream.getvalue()


class LocalSpeechTests(unittest.TestCase):
    def test_audio_format_validation(self) -> None:
        validate_wav(make_wav())
        for body in [make_wav(channels=2), make_wav(rate=24000), b"invalid"]:
            with self.assertRaises((ValueError, wave.Error, EOFError)):
                validate_wav(body)

    def test_local_http_transcription_and_origin_rejection(self) -> None:
        class Model:
            def transcribe(self, audio: io.BytesIO, **options):
                validate_wav(audio.getvalue())
                self.options = options
                return iter([SimpleNamespace(text="こんにちは")]), None

        model = Model()
        server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(model))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
            connection.request("GET", "/health")
            response = connection.getresponse()
            self.assertTrue(json.loads(response.read())["ready"])
            connection.request("POST", "/transcribe", make_wav(), {"Content-Type": "audio/wav"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())["text"], "こんにちは")
            self.assertEqual(model.options["language"], "ja")
            connection.request("POST", "/transcribe", make_wav(), {"Content-Type": "audio/wav", "Origin": "https://example.com"})
            response = connection.getresponse()
            self.assertEqual(response.status, 403)
            response.read()
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
