from __future__ import annotations

import platform
from enum import StrEnum

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class VoiceProfile(StrEnum):
    LOCAL = "local"
    ULTRA = "ultra"


class STTProvider(StrEnum):
    AUTO = "auto"
    MLX_WHISPER = "mlx_whisper"
    WHISPER = "whisper"
    DEEPGRAM_FLUX = "deepgram_flux"
    GROQ = "groq"


class LLMProvider(StrEnum):
    OLLAMA = "ollama"
    GROQ = "groq"
    OPENAI_COMPATIBLE = "openai_compatible"


class TTSProvider(StrEnum):
    KOKORO = "kokoro"
    CARTESIA = "cartesia"
    GROQ = "groq"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    voice_profile: VoiceProfile = VoiceProfile.LOCAL
    allow_external_ai: bool = False

    app_api_base_url: str = "http://127.0.0.1:3001"
    voice_service_token: SecretStr = Field(min_length=32)

    twilio_account_sid: str
    twilio_auth_token: SecretStr

    stt_provider: STTProvider = STTProvider.AUTO
    whisper_model: str = "mlx-community/whisper-large-v3-turbo-q4"
    whisper_device: str = "mps"
    whisper_compute_type: str = "int8"

    llm_provider: LLMProvider = LLMProvider.OLLAMA
    llm_model: str = "qwen3:8b"
    llm_base_url: str = "http://127.0.0.1:11434/v1"
    llm_api_key: SecretStr = SecretStr("ollama")

    tts_provider: TTSProvider = TTSProvider.KOKORO
    tts_voice: str = "af_heart"

    deepgram_api_key: SecretStr | None = None
    cartesia_api_key: SecretStr | None = None
    groq_api_key: SecretStr | None = None

    call_idle_timeout_seconds: int = Field(default=90, ge=15, le=600)
    api_timeout_seconds: float = Field(default=8.0, ge=1, le=30)
    summary_timeout_seconds: float = Field(default=10.0, ge=1, le=30)

    @model_validator(mode="after")
    def validate_provider_policy(self) -> Settings:
        external = (
            self.stt_provider in {STTProvider.DEEPGRAM_FLUX, STTProvider.GROQ}
            or self.llm_provider == LLMProvider.GROQ
            or self.tts_provider in {TTSProvider.CARTESIA, TTSProvider.GROQ}
        )
        if external and not self.allow_external_ai:
            raise ValueError(
                "Cloud voice providers require ALLOW_EXTERNAL_AI=true after provider approval"
            )

        required = {
            "Deepgram": (
                self.stt_provider == STTProvider.DEEPGRAM_FLUX,
                self.deepgram_api_key,
            ),
            "Cartesia": (self.tts_provider == TTSProvider.CARTESIA, self.cartesia_api_key),
            "Groq": (
                STTProvider.GROQ == self.stt_provider
                or LLMProvider.GROQ == self.llm_provider
                or TTSProvider.GROQ == self.tts_provider,
                self.groq_api_key,
            ),
        }
        missing = [name for name, (used, key) in required.items() if used and not key]
        if missing:
            raise ValueError(f"Missing API key for configured provider(s): {', '.join(missing)}")
        return self

    def resolved_stt_provider(self) -> STTProvider:
        if self.stt_provider != STTProvider.AUTO:
            return self.stt_provider
        if platform.system() == "Darwin" and platform.machine() == "arm64":
            return STTProvider.MLX_WHISPER
        return STTProvider.WHISPER

    @classmethod
    def ultra_defaults(cls, **overrides: object) -> Settings:
        return cls(
            voice_profile=VoiceProfile.ULTRA,
            allow_external_ai=True,
            stt_provider=STTProvider.DEEPGRAM_FLUX,
            llm_provider=LLMProvider.GROQ,
            llm_model="openai/gpt-oss-20b",
            tts_provider=TTSProvider.CARTESIA,
            **overrides,
        )
