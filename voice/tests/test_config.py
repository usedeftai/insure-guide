import pytest
from pydantic import ValidationError

from insure_voice.config import LLMProvider, Settings, STTProvider, TTSProvider


BASE = {
    "VOICE_SERVICE_TOKEN": "v" * 32,
    "TWILIO_ACCOUNT_SID": "AC_test",
    "TWILIO_AUTH_TOKEN": "secret",
}


def test_local_profile_defaults_to_private_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in BASE.items():
        monkeypatch.setenv(key, value)
    settings = Settings(_env_file=None)
    assert settings.llm_provider == LLMProvider.OLLAMA
    assert settings.tts_provider == TTSProvider.KOKORO
    assert settings.allow_external_ai is False


def test_cloud_provider_requires_explicit_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in BASE.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("STT_PROVIDER", STTProvider.DEEPGRAM_FLUX)
    monkeypatch.setenv("DEEPGRAM_API_KEY", "key")
    with pytest.raises(ValidationError, match="ALLOW_EXTERNAL_AI"):
        Settings(_env_file=None)
