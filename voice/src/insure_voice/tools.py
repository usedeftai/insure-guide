from __future__ import annotations

from typing import Any

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams

from .bridge import HonoVoiceBridge, VoiceBootstrap


def build_tools(bridge: HonoVoiceBridge, bootstrap: VoiceBootstrap) -> ToolsSchema:
    async def rag_lookup(params: FunctionCallParams) -> None:
        result = await bridge.rag_lookup(
            query=str(params.arguments["query"]),
            match_count=int(params.arguments.get("match_count", 5)),
            state=_optional_str(params.arguments.get("state")),
        )
        await params.result_callback(result)

    async def fill_field(params: FunctionCallParams) -> None:
        field_id = str(params.arguments["field_id"])
        if field_id not in bootstrap.voice_field_ids:
            await params.result_callback({"error": "That field cannot be collected by voice."})
            return
        result = await bridge.fill_field(
            bootstrap,
            field_id=field_id,
            value=str(params.arguments["value"]),
        )
        await params.result_callback(result)

    async def search_form(params: FunctionCallParams) -> None:
        result = await bridge.search_form(str(params.arguments["form_name"]))
        await params.result_callback(result)

    return ToolsSchema(
        standard_tools=[
            FunctionSchema(
                name="rag_lookup",
                description=(
                    "Look up current insurance program, eligibility, enrollment, or policy "
                    "information. Use this instead of guessing factual policy details."
                ),
                properties={
                    "query": {
                        "type": "string",
                        "description": (
                            "A focused English search question. Silently translate the caller's "
                            "request to English for retrieval when needed."
                        ),
                    },
                    "match_count": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 8,
                        "default": 5,
                    },
                    "state": {
                        "type": "string",
                        "description": "Two-letter state code, if the caller named one.",
                    },
                },
                required=["query"],
                handler=rag_lookup,
            ),
            FunctionSchema(
                name="fill_form_field",
                description=(
                    "Save one caller-confirmed, non-sensitive form answer. Repeat the value "
                    "back and get confirmation before calling this tool."
                ),
                properties={
                    "field_id": {
                        "type": "string",
                        "enum": bootstrap.voice_field_ids,
                    },
                    "value": {"type": "string"},
                },
                required=["field_id", "value"],
                handler=fill_field,
            ),
            FunctionSchema(
                name="search_form",
                description="Find insurance forms by name or purpose.",
                properties={"form_name": {"type": "string"}},
                required=["form_name"],
                handler=search_form,
            ),
        ]
    )


def _optional_str(value: Any) -> str | None:
    return str(value) if value is not None else None
