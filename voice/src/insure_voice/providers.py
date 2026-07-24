from __future__ import annotations

from typing import Any

from pipecat.transcriptions.language import Language

from .config import LLMProvider, Settings, STTProvider, TTSProvider


def build_llm(settings: Settings, system_prompt: str) -> Any:
    common = {
        "model": settings.llm_model,
        "system_instruction": system_prompt,
        "temperature": 0.15,
        "max_tokens": 180,
    }

    if settings.llm_provider == LLMProvider.OLLAMA:
        from pipecat.services.ollama.llm import OLLamaLLMService

        return OLLamaLLMService(
            base_url=settings.llm_base_url,
            settings=OLLamaLLMService.Settings(
                **common,
                extra={"extra_body": {"think": False}},
            ),
        )

    if settings.llm_provider == LLMProvider.GROQ:
        from pipecat.services.groq.llm import GroqLLMService

        return GroqLLMService(
            api_key=_secret(settings.groq_api_key),
            settings=GroqLLMService.Settings(**common),
        )

    from pipecat.services.openai.llm import OpenAILLMService

    return OpenAILLMService(
        api_key=settings.llm_api_key.get_secret_value(),
        base_url=settings.llm_base_url,
        settings=OpenAILLMService.Settings(**common),
    )


def build_stt(settings: Settings) -> tuple[Any, bool]:
    """Return the STT service and whether it owns user-turn boundaries."""
    provider = settings.resolved_stt_provider()

    if provider == STTProvider.DEEPGRAM_FLUX:
        from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService

        service = DeepgramFluxSTTService(
            api_key=_secret(settings.deepgram_api_key),
            mip_opt_out=True,
            settings=DeepgramFluxSTTService.Settings(
                model="flux-general-multi",
                language=None,
                language_hints=None,
                eager_eot_threshold=0.5,
                eot_threshold=0.8,
                eot_timeout_ms=1200,
                keyterm=[
                    "Medicaid",
                    "Medicare",
                    "CHIP",
                    "premium tax credit",
                    "deductible",
                ],
                min_confidence=0.4,
            ),
        )
        return service, True

    if provider == STTProvider.GROQ:
        from pipecat.services.groq.stt import GroqSTTService

        service = GroqSTTService(
            api_key=_secret(settings.groq_api_key),
            settings=GroqSTTService.Settings(
                model="whisper-large-v3-turbo",
                language=Language.EN,
                prompt="Insurance benefits, Medicaid, Medicare, CHIP, eligibility, enrollment.",
                temperature=0.0,
            ),
        )
        return service, False

    # This module loads MLX only inside the macOS branch. Importing it on a
    # headless host can terminate the process before Python can raise an error.
    from pipecat.services.whisper.stt import WhisperSTTService, WhisperSTTServiceMLX

    if provider == STTProvider.MLX_WHISPER:
        service = WhisperSTTServiceMLX(
            settings=WhisperSTTServiceMLX.Settings(
                model=settings.whisper_model,
                language=None,
                no_speech_prob=0.6,
                temperature=0.0,
                engine="mlx",
            ),
            ttfs_p99_latency=0.75,
        )
        return service, False

    model = settings.whisper_model
    if model.startswith("mlx-community/"):
        model = "deepdml/faster-whisper-large-v3-turbo-ct2"
    service = WhisperSTTService(
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
        settings=WhisperSTTService.Settings(
            model=model,
            language=None,
            no_speech_prob=0.5,
        ),
        ttfs_p99_latency=0.9,
    )
    return service, False


def build_tts(settings: Settings) -> Any:
    if settings.tts_provider == TTSProvider.CARTESIA:
        from pipecat.services.cartesia.tts import CartesiaTTSService
        from pipecat.services.tts_service import TextAggregationMode

        return CartesiaTTSService(
            api_key=_secret(settings.cartesia_api_key),
            text_aggregation_mode=TextAggregationMode.TOKEN,
            max_buffer_delay_ms=0,
            settings=CartesiaTTSService.Settings(
                model="sonic-3.5",
                voice=settings.tts_voice,
                language=Language.EN,
            ),
        )

    if settings.tts_provider == TTSProvider.GROQ:
        from pipecat.services.groq.tts import GroqTTSService

        return GroqTTSService(
            api_key=_secret(settings.groq_api_key),
            settings=GroqTTSService.Settings(
                model="canopylabs/orpheus-v1-english",
                voice=settings.tts_voice,
                language=Language.EN,
                speed=1.08,
            ),
        )

    from pipecat.services.kokoro.tts import KokoroTTSService

    return KokoroTTSService(
        settings=KokoroTTSService.Settings(
            model=None,
            voice=settings.tts_voice,
            language=Language.EN,
        )
    )


def tts_language_delta(tts: Any, language: Language) -> Any:
    """Build a provider-specific runtime language update for the active TTS."""
    provider = type(tts).__name__
    if provider == "GroqTTSService":
        return tts.Settings(language=Language.EN)
    if provider == "KokoroTTSService":
        base_language = str(language).lower().split("-")[0]
        voices = {
            "en": "af_heart",
            "es": "ef_dora",
            "fr": "ff_siwis",
            "hi": "hf_alpha",
            "it": "if_sara",
            "ja": "jf_alpha",
            "pt": "pf_dora",
            "zh": "zf_xiaobei",
        }
        if base_language not in voices:
            return tts.Settings(language=Language.EN, voice=voices["en"])
        return tts.Settings(language=language, voice=voices[base_language])
    return tts.Settings(language=language)


def _secret(value: Any) -> str:
    if value is None:
        raise ValueError("Required provider API key is missing")
    return value.get_secret_value()
