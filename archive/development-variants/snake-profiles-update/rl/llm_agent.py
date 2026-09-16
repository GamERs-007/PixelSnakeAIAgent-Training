"""Experimental text-only Snake policy using an installed, local Ollama model."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np

ACTIONS = {"STRAIGHT": 0, "LEFT": 1, "RIGHT": 2}
ACTION_SCHEMA = {"type": "object", "properties": {"action": {"type": "string", "enum": list(ACTIONS)}},
                 "required": ["action"], "additionalProperties": False}
SYSTEM_PROMPT = """Control Snake for one move. Return ONLY a JSON object with exactly one key:
{"action":"STRAIGHT"}, {"action":"LEFT"}, or {"action":"RIGHT"}.
Actions are RELATIVE to current_direction: STRAIGHT keeps heading, LEFT turns
90 degrees counterclockwise, RIGHT turns 90 degrees clockwise. Never reverse.
Danger flags describe collisions on the next move. Choose a non-dangerous action
when possible, then move toward food. Food direction is absolute on the screen:
upper means up, lower means down. Prefer STRAIGHT when equally good.
Do not explain. Do not include markdown or other fields."""


def structured_state(observation):
    """Translate numeric observation; never include pixels, body coordinates or history."""
    obs = np.asarray(observation)
    if obs.shape != (10,) or not np.isfinite(obs).all():
        raise ValueError("Expected the finite 10-element SnakeEnv observation")
    horizontal = "left" if obs[7] < 0 else "right" if obs[7] > 0 else ""
    vertical = "upper" if obs[8] < 0 else "lower" if obs[8] > 0 else ""
    food = "_".join(part for part in (vertical, horizontal) if part) or "same_cell"
    return {"danger_straight": bool(obs[0]), "danger_left": bool(obs[1]),
            "danger_right": bool(obs[2]), "food_direction": food,
            "current_direction": ("up", "right", "down", "left")[int(np.argmax(obs[3:7]))]}


def validate_action(content):
    """Strict JSON, unique key, exact enum; no regex extraction or coercion."""
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result
    if not isinstance(content, str):
        raise ValueError("Expected text JSON")
    try:
        value = json.loads(content, object_pairs_hook=unique)
    except (ValueError, TypeError) as error:
        raise ValueError("Invalid JSON action") from error
    if (not isinstance(value, dict) or set(value) != {"action"}
            or not isinstance(value["action"], str) or value["action"] not in ACTIONS):
        raise ValueError("Expected exactly one allowed action")
    return ACTIONS[value["action"]]


def safe_fallback(observation):
    # Deterministic and deliberately simple: straight, left, right. All blocked:
    # no move is safe, but straight remains a valid relative action.
    return next((a for a in range(3) if observation[a] == 0), 0)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.URLError("Redirects are forbidden for local inference")


class OllamaClient:
    def __init__(self, base_url="http://127.0.0.1:11434"):
        url = urllib.parse.urlsplit(base_url)
        if (url.scheme != "http" or url.hostname not in ("127.0.0.1", "::1")
                or url.username or url.password or url.path not in ("", "/")
                or url.query or url.fragment):
            raise ValueError("Ollama URL must be an HTTP literal loopback address")
        self.base_url = base_url.rstrip("/")
        # Never use system HTTP proxies or follow redirects to remote services.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, path, payload=None, timeout=120):
        if path not in ("/api/tags", "/api/show", "/api/chat", "/api/version", "/api/ps"):
            raise ValueError("Unsupported local endpoint")
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.base_url + path, data=data,
                                     headers={"Content-Type": "application/json"})
        with self.opener.open(req, timeout=timeout) as response:
            limit = 65536 if path == "/api/chat" else 4 * 1024 * 1024
            content = response.read(limit + 1)
        if len(content) > limit:
            raise ValueError("Oversized Ollama response")
        result = json.loads(content)
        if not isinstance(result, dict) or result.get("error"):
            raise ValueError("Ollama returned an error or malformed envelope")
        return result

    def verify_model(self, model):
        if "cloud" in model.lower():
            raise ValueError("Cloud models are forbidden")
        tags = self.request("/api/tags")
        matches = [item for item in tags.get("models", []) if item.get("name") == model]
        if not matches:
            raise ValueError("Model must already be installed locally; automatic downloads are disabled")
        details = self.request("/api/show", {"model": model})
        if (details.get("remote_host") or details.get("remote_model")
                or details.get("details", {}).get("format") != "gguf"):
            raise ValueError("Expected local GGUF weights, not a remote model")
        return {"tag": matches[0], "details": details.get("details"),
                "version": self.request("/api/version")}


class LLMAgent:
    """choose_action(observation) -> SnakeEnv integer action; last_decision holds telemetry.

    Call verify() before use. Valid but dangerous moves are executed unchanged;
    fallback is reserved for invalid responses and failed requests.
    """
    def __init__(self, model="qwen3.8:27b-q4_K_M", base_url="http://127.0.0.1:11434",
                 seed=42, timeout=120):
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.model, self.seed, self.timeout = model, seed, timeout
        self.client = OllamaClient(base_url)
        self.verified = False
        self.last_decision = None

    def verify(self):
        self.model_info = self.client.verify_model(self.model)
        self.verified = True
        return self.model_info

    def choose_action(self, observation, timeout=None):
        if not self.verified:
            raise RuntimeError("Call verify() to confirm installed local weights first")
        state = structured_state(observation)
        started = time.perf_counter()
        content, error, invalid, request_error = None, None, False, False
        try:
            response = self.client.request("/api/chat", {
                "model": self.model, "stream": False, "think": False,
                "format": ACTION_SCHEMA, "keep_alive": "5m",
                "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                             {"role": "user", "content": json.dumps(state, separators=(",", ":"))}],
                "options": {"temperature": 0, "seed": self.seed, "num_predict": 32, "num_ctx": 2048}},
                timeout=min(self.timeout, timeout) if timeout is not None else self.timeout)
        except (OSError, urllib.error.URLError, ValueError) as exc:
            request_error, error = True, str(exc)
        else:
            try:
                if response.get("done") is not True or response.get("done_reason") == "length":
                    raise ValueError("Incomplete or token-limited response")
                content = response.get("message", {}).get("content")
                action = validate_action(content)
            except (ValueError, TypeError, AttributeError) as exc:
                invalid, error = True, str(exc)
        fallback = invalid or request_error
        if fallback:
            action = safe_fallback(observation)
        self.last_decision = {"state": state, "raw_response": content, "action": action,
                              "latency_ms": (time.perf_counter() - started) * 1000,
                              "invalid_response": invalid, "request_error": request_error,
                              "fallback": fallback, "dangerous_action": bool(observation[action]),
                              "error": error}
        return action
