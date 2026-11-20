#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$ROOT_DIR/backend/python-engine/.venv"
MODEL_DIR="$ROOT_DIR/backend/storage/models/kokoro"

echo "=== [OpenClip TTS Setup] Initializing Offline & Cloud TTS Engine ==="

# 1. Ensure venv exists
if [ ! -d "$VENV_DIR" ]; then
  echo "Virtual environment not found at $VENV_DIR. Creating..."
  python3 -m venv "$VENV_DIR"
fi

# 2. Install Python TTS packages
echo "Installing/verifying Python TTS packages (kokoro-onnx, soundfile, onnxruntime)..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet kokoro-onnx soundfile onnxruntime

# 3. Download Kokoro-82M model weights & voices if not present
mkdir -p "$MODEL_DIR"

KOKORO_ONNX="$MODEL_DIR/kokoro-v0_19.onnx"
VOICES_BIN="$MODEL_DIR/voices.bin"

if [ ! -f "$KOKORO_ONNX" ] || [ ! -s "$KOKORO_ONNX" ] || [ $(wc -c < "$KOKORO_ONNX") -lt 300000000 ]; then
  echo "Downloading Kokoro-82M ONNX model (kokoro-v0_19.onnx)..."
  curl -L --http1.1 -C - --progress-bar -o "$KOKORO_ONNX" \
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/kokoro-v0_19.onnx"
else
  echo "Kokoro-82M ONNX model already present ($(du -h "$KOKORO_ONNX" | cut -f1))."
fi

if [ ! -f "$VOICES_BIN" ] || [ ! -s "$VOICES_BIN" ] || [ $(wc -c < "$VOICES_BIN") -lt 50000000 ]; then
  echo "Downloading Kokoro voices bundle (voices.bin)..."
  curl -L --http1.1 -C - --progress-bar -o "$VOICES_BIN" \
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/voices.bin"
else
  echo "Kokoro voices bundle already present ($(du -h "$VOICES_BIN" | cut -f1))."
fi

echo "=== [OpenClip TTS Setup] Kokoro TTS Setup Complete! ==="
