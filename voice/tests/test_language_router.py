from pipecat.frames.frames import TranscriptionFrame
from pipecat.transcriptions.language import Language

from insure_voice.language_router import detected_language


def test_detects_language_when_stt_does_not_supply_one() -> None:
    frame = TranscriptionFrame(
        text="Necesito ayuda para solicitar un seguro médico.",
        user_id="",
        timestamp="2026-07-22T00:00:00Z",
    )
    assert detected_language(frame) == Language.ES


def test_prefers_stt_language() -> None:
    frame = TranscriptionFrame(
        text="Bonjour",
        user_id="",
        timestamp="2026-07-22T00:00:00Z",
        language=Language.FR,
    )
    assert detected_language(frame) == Language.FR
