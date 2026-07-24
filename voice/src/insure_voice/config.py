from __future__ import annotations

import platform
from enum import StrEnum
from typing import Any
from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator, model_validator
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
    voice_public_base_url: str | None = None
    twilio_validate_signatures: bool = True

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

    @field_validator("voice_public_base_url", mode="before")
    @classmethod
    def validate_public_url(cls, value: object) -> str | None:
        if value is None or value == "":
            return None
        if not isinstance(value, str):
            raise ValueError("VOICE_PUBLIC_BASE_URL must be a string")
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("VOICE_PUBLIC_BASE_URL must be an absolute HTTP(S) origin")
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError("VOICE_PUBLIC_BASE_URL must not include a path, query, or fragment")
        return value.rstrip("/")

    @field_validator(
        "deepgram_api_key",
        "cartesia_api_key",
        "groq_api_key",
        mode="before",
    )
    @classmethod
    def empty_optional_secret_is_unset(cls, value: object) -> object | None:
        return None if value == "" else value

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
    def ultra_defaults(cls, **overrides: Any) -> Settings:
        values: dict[str, Any] = {
            "voice_profile": VoiceProfile.ULTRA,
            "allow_external_ai": True,
            "stt_provider": STTProvider.DEEPGRAM_FLUX,
            "llm_provider": LLMProvider.GROQ,
            "llm_model": "openai/gpt-oss-20b",
            "tts_provider": TTSProvider.CARTESIA,
            **overrides,
        }
        return cls.model_validate(values)
