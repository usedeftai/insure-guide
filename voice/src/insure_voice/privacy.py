from __future__ import annotations

import re
from typing import Any

import httpx

from .config import LLMProvider, Settings

_SSN = re.compile(r"\b\d{3}[- ]?\d{2}[- ]?\d{4}\b")
_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_PHONE = re.compile(r"(?<!\d)(?:\+?1[-. ()]?)?(?:\d{3}[-. ()]?){2}\d{4}(?!\d)")
_THINKING = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)


def redact_text(value: str) -> str:
    value = _SSN.sub("[REDACTED_SSN]", value)
    value = _EMAIL.sub("[REDACTED_EMAIL]", value)
    return _PHONE.sub("[REDACTED_PHONE]", value)


def transcript_text(messages: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for message in messages:
        role = str(message.get("role", "unknown"))
        content = message.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        lines.append(f"{role}: {redact_text(content)}")
    return "\n".join(lines)


async def summarize_call(messages: list[dict[str, Any]], settings: Settings) -> str:
    transcript = transcript_text(messages)
    if not transcript:
        return "Call ended before any substantive conversation was captured."

    endpoint, api_key = _summary_endpoint(settings)
    request = {
        "model": settings.llm_model,
        "temperature": 0,
        "max_tokens": 220,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Create a terse continuity note for the next insurance-support call. "
                    "Include goals, decisions, confirmed non-sensitive form progress, and open "
                    "questions. Never include phone numbers, email addresses, SSNs, direct "
                    "quotes, credentials, or medical details. Return only the note."
                ),
            },
            {"role": "user", "content": transcript},
        ],
    }
    if settings.llm_provider == LLMProvider.OLLAMA:
        request["think"] = False
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(settings.summary_timeout_seconds)
        ) as client:
            response = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {api_key}"},
                json=request,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            if isinstance(content, str) and content.strip():
                content = _THINKING.sub("", content)
                return redact_text(content.strip())[:8000]
    except (httpx.HTTPError, KeyError, IndexError, TypeError):
        pass

    return "Caller discussed insurance navigation; detailed call content was not retained."


def _summary_endpoint(settings: Settings) -> tuple[str, str]:
    if settings.llm_provider == LLMProvider.GROQ:
        return (
            "https://api.groq.com/openai/v1/chat/completions",
            settings.groq_api_key.get_secret_value() if settings.groq_api_key else "",
        )
    return (
        f"{settings.llm_base_url.rstrip('/')}/chat/completions",
        settings.llm_api_key.get_secret_value(),
    )
