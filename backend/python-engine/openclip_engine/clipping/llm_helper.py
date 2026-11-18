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


def list_configured_providers() -> list[str]:
    """Returns configured provider names from OpenClip's environment registry."""
    if os.getenv("OPENCLIP_DISABLE_LLM", "").lower() in ("1", "true", "yes"):
        return []
    out: list[str] = []
    if GROQ_API_KEY or os.getenv("GROQ_API_KEY", ""):
        out.append("groq")
    if GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", ""):
        out.append("gemini")
    if NVIDIA_API_KEY or os.getenv("NVIDIA_API_KEY", ""):
        out.append("nvidia")
    return out


def call_provider_json(
    provider_name: str,
    prompt: str,
    system_prompt: str = "",
    temperature: float = 0.0,
    timeout_s: float = 14.0,
) -> Optional[Any]:
    """Calls a specific OpenClip LLM provider ('groq' | 'gemini' | 'nvidia') and parses JSON."""
    if os.getenv("OPENCLIP_DISABLE_LLM", "").lower() in ("1", "true", "yes"):
        return None
    try:
        import httpx
    except Exception:
        return None

    pname = provider_name.strip().lower()
    if pname == "groq":
        key = GROQ_API_KEY or os.getenv("GROQ_API_KEY", "")
        if not key:
            return None
        msgs = ([{"role": "system", "content": system_prompt}] if system_prompt else []) + [{"role": "user", "content": prompt}]
        groq_models = [os.getenv("GROQ_MODEL")] if os.getenv("GROQ_MODEL") else ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile"]
        for model_id in groq_models:
            if not model_id:
                continue
            try:
                payload: dict[str, Any] = {
                    "model": model_id,
                    "messages": msgs,
                    "temperature": temperature,
                    "max_tokens": 2048 if model_id.startswith("openai/gpt-oss-") else 1024,
                }
                if model_id.startswith("openai/gpt-oss-"):
                    payload["reasoning_effort"] = "low"
                resp = httpx.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json=payload,
                    timeout=timeout_s,
                )
                if resp.status_code == 200:
                    msg_content = resp.json()["choices"][0]["message"].get("content") or ""
                    parsed = _extract_json_block(msg_content)
                    if parsed is not None:
                        return parsed
            except Exception:
                continue
        return None

    if pname == "nvidia":
        key = NVIDIA_API_KEY or os.getenv("NVIDIA_API_KEY", "")
        if not key:
            return None
        try:
            msgs = ([{"role": "system", "content": system_prompt}] if system_prompt else []) + [{"role": "user", "content": prompt}]
            resp = httpx.post(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"model": "meta/llama-3.3-70b-instruct", "messages": msgs, "temperature": temperature, "max_tokens": 1024},
                timeout=timeout_s,
            )
            if resp.status_code == 200:
                return _extract_json_block(resp.json()["choices"][0]["message"]["content"])
        except Exception:
            return None
        return None

    if pname == "gemini":
        key = GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
        if not key:
            return None
        try:
            full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
            resp = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}",
                headers={"Content-Type": "application/json"},
                json={"contents": [{"parts": [{"text": full_prompt}]}], "generationConfig": {"temperature": temperature}},
                timeout=timeout_s,
            )
            if resp.status_code == 200:
                parts = resp.json()["candidates"][0]["content"]["parts"]
                return _extract_json_block("".join(p.get("text", "") for p in parts))
        except Exception:
            return None
        return None

    return None


def call_llm_json(prompt: str, system_prompt: str = "", timeout_s: float = 12.0) -> Optional[Any]:
    """
    Calls the first available configured OpenClip LLM provider (Groq -> Gemini -> NVIDIA)
    and parses a JSON response. Returns None if offline, unconfigured, or invalid JSON.
    """
    for prov in list_configured_providers():
        res = call_provider_json(prov, prompt, system_prompt=system_prompt, temperature=0.2, timeout_s=timeout_s)
        if res is not None:
            return res
    return None
