import pytest

from elephant_lab.assistant.config import AssistantConfiguration


def _settings(api_url, api_key, model):
    return {
        "apiUrl": api_url,
        "apiKey": api_key,
        "model": model,
    }


def test_loads_direct_assistant_settings():
    configuration = AssistantConfiguration.from_settings(
        _settings(
            {"source": "value", "value": "https://api.example.test/v1"},
            {"source": "value", "value": "secret"},
            {"source": "value", "value": "model-name"},
        )
    )

    assert configuration.api_base == "https://api.example.test/v1"
    assert configuration.api_key == "secret"
    assert configuration.model == "model-name"


def test_resolves_environment_variable_settings(monkeypatch):
    monkeypatch.setenv("TEST_ASSISTANT_KEY", "secret")
    configuration = AssistantConfiguration.from_settings(
        _settings(
            {"source": "value", "value": "https://api.example.test/v1"},
            {"source": "environment", "value": "TEST_ASSISTANT_KEY"},
            {"source": "value", "value": "model-name"},
        )
    )

    assert configuration.api_key == "secret"


def test_rejects_empty_environment_variable(monkeypatch):
    monkeypatch.setenv("TEST_ASSISTANT_KEY", "   ")
    with pytest.raises(ValueError, match="is empty"):
        AssistantConfiguration.from_settings(
            _settings(
                {"source": "value", "value": "https://api.example.test/v1"},
                {"source": "environment", "value": "TEST_ASSISTANT_KEY"},
                {"source": "value", "value": "model-name"},
            )
        )


@pytest.mark.parametrize(
    ("api_url", "api_key", "model", "message"),
    [
        (
            {"source": "value", "value": "not-a-url"},
            {"source": "value", "value": "secret"},
            {"source": "value", "value": "model-name"},
            "Assistant API URL",
        ),
        (
            {"source": "value", "value": "https://api.example.test/v1"},
            {"source": "environment", "value": "MISSING_ASSISTANT_KEY"},
            {"source": "value", "value": "model-name"},
            "Environment variable",
        ),
        (
            {"source": "value", "value": "https://api.example.test/v1"},
            {"source": "value", "value": ""},
            {"source": "value", "value": "model-name"},
            "Enter a value",
        ),
    ],
)
def test_rejects_invalid_assistant_settings(
    api_url, api_key, model, message, monkeypatch
):
    monkeypatch.delenv("MISSING_ASSISTANT_KEY", raising=False)
    with pytest.raises(ValueError, match=message):
        AssistantConfiguration.from_settings(_settings(api_url, api_key, model))
