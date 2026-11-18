"""
Lightweight Python bridge to OpenClip's configured LLM providers
(Groq, NVIDIA NIM, Google Gemini) using openclip_engine.core.config keys.
Always returns None on network/API unavailability so callers fall back cleanly.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

from openclip_engine.core.config import GEMINI_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY


def _extract_json_block(raw: str) -> Any:
    txt = (raw or "").strip()
    if not txt:
        return None
    if "```json" in txt:
        txt = txt.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in txt:
        txt = txt.split("```", 1)[1].split("```", 1)[0].strip()
    try:
        return json.loads(txt)
    except Exception:
        m = re.search(r"(\{.*\}|\[.*\])", txt, flags=re.S)
        if m:
            try:
                return json.loads(m.group(1))
            except Exception:
                return None
    return None


def call_llm_json(prompt: str, system_prompt: str = "", timeout_s: float = 12.0) -> Optional[Any]:
    """
    Calls the first available configured OpenClip LLM provider (Groq -> NVIDIA -> Gemini)
    and parses a JSON response. Returns None if offline, unconfigured, or invalid JSON.
    """
    if os.getenv("OPENCLIP_DISABLE_LLM", "").lower() in ("1", "true", "yes"):
        return None

    try:
        import httpx
    except Exception:
        return None

    # 1. Groq (OpenAI-compatible)
    groq_key = GROQ_API_KEY or os.getenv("GROQ_API_KEY", "")
    if groq_key:
        try:
            msgs = []
            if system_prompt:
                msgs.append({"role": "system", "content": system_prompt})
            msgs.append({"role": "user", "content": prompt})
            resp = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                json={"model": "llama-3.3-70b-versatile", "messages": msgs, "temperature": 0.2, "max_tokens": 512},
                timeout=timeout_s,
            )
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"]["content"]
                parsed = _extract_json_block(content)
                if parsed is not None:
                    return parsed
        except Exception:
            pass

    # 2. NVIDIA NIM (OpenAI-compatible)
    nvidia_key = NVIDIA_API_KEY or os.getenv("NVIDIA_API_KEY", "")
    if nvidia_key:
        try:
            msgs = []
            if system_prompt:
                msgs.append({"role": "system", "content": system_prompt})
            msgs.append({"role": "user", "content": prompt})
            resp = httpx.post(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {nvidia_key}", "Content-Type": "application/json"},
                json={"model": "meta/llama-3.3-70b-instruct", "messages": msgs, "temperature": 0.2, "max_tokens": 512},
                timeout=timeout_s,
            )
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"]["content"]
                parsed = _extract_json_block(content)
                if parsed is not None:
                    return parsed
        except Exception:
            pass

    # 3. Google Gemini
    gemini_key = GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
    if gemini_key:
        try:
            full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
            resp = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}",
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": full_prompt}]}], "generationConfig": {"temperature": 0.2}},
                timeout=timeout_s,
            )
            if resp.status_code == 200:
                parts = resp.json()["candidates"][0]["content"]["parts"]
                content = "".join(p.get("text", "") for p in parts)
                parsed = _extract_json_block(content)
                if parsed is not None:
                    return parsed
        except Exception:
            pass

    return None
