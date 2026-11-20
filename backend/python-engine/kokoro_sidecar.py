#!/usr/bin/env python3
"""
Kokoro-82M Long-Lived Python Sidecar for Story Studio
Loads the Kokoro ONNX model ONCE into memory and synthesizes speech per line.
Communicates via JSON protocol over stdin/stdout.
"""

import sys
import os
import json
import time
import soundfile as sf
import numpy as np

MODEL_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../storage/models/kokoro"))
ONNX_PATH = os.path.join(MODEL_DIR, "kokoro-v0_19.onnx")
VOICES_PATH = os.path.join(MODEL_DIR, "voices.bin")

kokoro_instance = None
cached_voices = []

def init_kokoro():
    global kokoro_instance, cached_voices
    if kokoro_instance is not None:
        return True

    if not os.path.exists(ONNX_PATH) or not os.path.exists(VOICES_PATH):
        sys.stderr.write(f"[KokoroSidecar] Model files missing in {MODEL_DIR}\n")
        return False

    try:
        from kokoro_onnx import Kokoro
        t0 = time.time()
        kokoro_instance = Kokoro(ONNX_PATH, VOICES_PATH)
        cached_voices = kokoro_instance.get_voices()
        load_time = time.time() - t0
        sys.stderr.write(f"[KokoroSidecar] Kokoro-82M initialized in {load_time:.2f}s with {len(cached_voices)} voices.\n")
        return True
    except Exception as e:
        sys.stderr.write(f"[KokoroSidecar] Error initializing Kokoro: {str(e)}\n")
        return False

def list_voices():
    if not init_kokoro():
        return []
    # Return structured metadata for voices
    result = []
    for v in cached_voices:
        # Voice prefixes: af = American Female, am = American Male, bf = British Female, bm = British Male
        gender = "female" if (v.startswith("af_") or v.startswith("bf_")) else "male"
        accent = "UK" if (v.startswith("bf_") or v.startswith("bm_")) else "US"
        result.append({
            "id": v,
            "name": v.replace("_", " ").title(),
            "gender": gender,
            "accent": accent,
            "provider": "kokoro-local"
        })
    return result

def synthesize(text, voice="af_heart", speed=1.0, output_path=None):
    if not init_kokoro():
        raise RuntimeError("Kokoro model not initialized")

    # If voice requested is not in Kokoro, fallback to af_heart or first available
    available = cached_voices
    if voice not in available:
        # Match by gender if possible
        matched = None
        for av in available:
            if voice.lower() in av.lower():
                matched = av
                break
        voice = matched or ("af_heart" if "af_heart" in available else available[0])

    t0 = time.time()
    samples, sample_rate = kokoro_instance.create(
        text.strip(),
        voice=voice,
        speed=float(speed),
        lang="en-us"
    )
    synth_time = time.time() - t0

    duration_sec = len(samples) / float(sample_rate)

    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        sf.write(output_path, samples, sample_rate)

    return {
        "voice": voice,
        "sampleRate": sample_rate,
        "durationSec": duration_sec,
        "samplesCount": len(samples),
        "synthElapsedSec": synth_time,
        "outputPath": output_path
    }

def main():
    # Handle single command line invocation for tests: python kokoro_sidecar.py --test
    if len(sys.argv) > 1 and sys.argv[1] == "--doctor":
        if init_kokoro():
            voices = list_voices()
            print(json.dumps({"status": "ready", "voicesCount": len(voices), "voices": voices[:6]}))
            sys.exit(0)
        else:
            print(json.dumps({"status": "not_ready", "reason": f"Model files missing at {ONNX_PATH}"}))
            sys.exit(1)

    # Standard JSON-lines protocol over stdio
    init_kokoro()
    sys.stderr.write("[KokoroSidecar] Ready for requests.\n")
    sys.stderr.flush()

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id", f"req_{int(time.time()*1000)}")
            cmd = req.get("command", "synthesize")

            if cmd == "ping" or cmd == "health":
                ready = init_kokoro()
                resp = {
                    "id": req_id,
                    "status": "ready" if ready else "not_ready",
                    "voicesCount": len(cached_voices)
                }
            elif cmd == "list_voices":
                resp = {
                    "id": req_id,
                    "status": "ok",
                    "voices": list_voices()
                }
            elif cmd == "synthesize":
                text = req.get("text", "")
                voice = req.get("voice", "af_heart")
                speed = req.get("speed", 1.0)
                out_path = req.get("outputPath")
                result = synthesize(text, voice, speed, out_path)
                resp = {
                    "id": req_id,
                    "status": "ok",
                    **result
                }
            else:
                resp = {"id": req_id, "status": "error", "message": f"Unknown command: {cmd}"}

            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"status": "error", "message": str(e)}) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
