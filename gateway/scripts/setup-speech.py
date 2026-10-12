"""Run only during first-time setup; subsequent launches use local files only."""
from pathlib import Path
from faster_whisper.utils import download_model

destination = Path(__file__).resolve().parents[1] / ".runtime" / "models" / "whisper-small"
destination.mkdir(parents=True, exist_ok=True)
download_model("small", output_dir=str(destination))
print("Japanese STT model downloaded. Start VOICEVOX locally, then Start-Gateway.cmd.")
