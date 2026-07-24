import os

os.environ.setdefault("VOICE_SERVICE_TOKEN", "v" * 32)
os.environ.setdefault("TWILIO_ACCOUNT_SID", "AC_test")
os.environ.setdefault("TWILIO_AUTH_TOKEN", "test-auth-token")
os.environ.setdefault("VOICE_PUBLIC_BASE_URL", "https://voice.example.com")

from fastapi.testclient import TestClient  # noqa: E402
from twilio.request_validator import RequestValidator  # noqa: E402

from server import app  # noqa: E402


def test_incoming_webhook_rejects_invalid_signature() -> None:
    client = TestClient(app)
    response = client.post(
        "/twilio/incoming",
        data={"From": "+12025550184", "To": "+12025550185"},
        headers={"x-twilio-signature": "invalid"},
    )
    assert response.status_code == 403


def test_incoming_webhook_returns_bidirectional_stream() -> None:
    client = TestClient(app)
    url = "https://voice.example.com/twilio/incoming"
    params = {"From": "+12025550184", "To": "+12025550185"}
    signature = RequestValidator("test-auth-token").compute_signature(url, params)

    response = client.post(
        "/twilio/incoming",
        data=params,
        headers={"x-twilio-signature": signature},
    )

    assert response.status_code == 200
    assert '<Stream url="wss://voice.example.com/twilio/media">' in response.text
    assert 'name="from_number"' in response.text
