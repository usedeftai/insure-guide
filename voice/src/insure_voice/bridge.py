from __future__ import annotations

from typing import Any

import httpx
from pydantic import BaseModel

from .config import Settings


class VoiceBootstrap(BaseModel):
    call_id: str
    user_id: str
    phone_number: str
    form_id: str
    voice_field_ids: list[str]
    system_prompt: str


class HonoVoiceBridge:
    """Authenticated control-plane client. It never logs request or response bodies."""

    def __init__(self, settings: Settings) -> None:
        self._client = httpx.AsyncClient(
            base_url=settings.app_api_base_url.rstrip("/"),
            headers={
                "Authorization": f"Bearer {settings.voice_service_token.get_secret_value()}"
            },
            timeout=httpx.Timeout(settings.api_timeout_seconds),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def bootstrap(self, call_id: str, phone_number: str) -> VoiceBootstrap:
        data = await self._post(
            "/internal/voice/bootstrap",
            {"call_id": call_id, "phone_number": phone_number},
        )
        return VoiceBootstrap.model_validate(data)

    async def rag_lookup(
        self, query: str, match_count: int = 5, state: str | None = None
    ) -> dict[str, Any]:
        return await self._post(
            "/internal/voice/tools/rag-lookup",
            {"query": query, "match_count": match_count, "state": state},
        )

    async def fill_field(
        self,
        bootstrap: VoiceBootstrap,
        field_id: str,
        value: str,
    ) -> dict[str, Any]:
        return await self._post(
            "/internal/voice/tools/fill-field",
            {
                "user_id": bootstrap.user_id,
                "phone_number": bootstrap.phone_number,
                "form_id": bootstrap.form_id,
                "field_id": field_id,
                "value": value,
            },
        )

    async def search_form(self, form_name: str) -> dict[str, Any]:
        return await self._post(
            "/internal/voice/tools/search-form",
            {"form_name": form_name},
        )

    async def complete(self, bootstrap: VoiceBootstrap, summary: str) -> None:
        await self._post(
            "/internal/voice/complete",
            {
                "call_id": bootstrap.call_id,
                "user_id": bootstrap.user_id,
                "phone_number": bootstrap.phone_number,
                "summary": summary,
            },
        )

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = await self._client.post(path, json=payload)
        response.raise_for_status()
        return response.json()
