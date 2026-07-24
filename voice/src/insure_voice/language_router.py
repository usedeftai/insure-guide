from __future__ import annotations

from typing import Any

import langid
from pipecat.frames.frames import Frame, TranscriptionFrame, TTSUpdateSettingsFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.transcriptions.language import Language

from .providers import tts_language_delta

langid.set_languages(["en", "es", "fr", "hi", "it", "ja", "pt", "zh"])


class TTSLanguageRouter(FrameProcessor):
    """Switch TTS language after STT detects a new language."""

    def __init__(self, tts: Any) -> None:
        super().__init__()
        self._tts = tts
        self._language: Language = Language.EN

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        language = detected_language(frame) if isinstance(frame, TranscriptionFrame) else None
        if (
            direction == FrameDirection.DOWNSTREAM
            and language is not None
            and language != self._language
        ):
            self._language = language
            await self.push_frame(
                TTSUpdateSettingsFrame(
                    delta=tts_language_delta(self._tts, language),
                    service=self._tts,
                ),
                direction,
            )
        await self.push_frame(frame, direction)


def detected_language(frame: TranscriptionFrame) -> Language | None:
    if frame.language is not None:
        return frame.language
    code, _ = langid.classify(frame.text)
    try:
        return Language(code)
    except ValueError:
        return None
