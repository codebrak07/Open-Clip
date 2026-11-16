#!/usr/bin/env bash
set -e

echo "=== OpenClip AI Native Python Environment Setup ==="

# Check Python 3
PYTHON_BIN=""
if command -v python3.13 &>/dev/null; then
    PYTHON_BIN="python3.13"
elif command -v python3 &>/dev/null; then
    PYTHON_BIN="python3"
else
    echo "Error: python3 is not installed."
    exit 1
fi

echo "Found Python: $($PYTHON_BIN --version) at $(which $PYTHON_BIN)"

# Check FFmpeg
if ! command -v ffmpeg &>/dev/null; then
    echo "Warning: ffmpeg not found in PATH. Install via 'brew install ffmpeg' or choco."
else
    echo "Found FFmpeg: $(which ffmpeg)"
fi

# Create Virtualenv
VENV_DIR="backend/python-engine/.venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment at $VENV_DIR..."
    $PYTHON_BIN -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
echo "Active Python: $(which python)"

echo "Installing OpenClip Engine requirements..."
pip install --upgrade pip
pip install -r backend/python-engine/requirements.txt
pip install -e backend/python-engine

echo "Running system diagnostics..."
PYTHONPATH=backend/python-engine python -m openclip_engine.cli.main doctor

echo "=== Native Python Setup Complete! ==="
echo "To activate: source $VENV_DIR/bin/activate"
echo "To run CLI: openclip doctor"
