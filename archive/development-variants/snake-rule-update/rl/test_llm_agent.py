"""Offline contract tests: no Ollama instance or model is needed."""
import json
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np

from rl.llm_agent import (LLMAgent, OllamaClient, NoRedirect, structured_state,
                          validate_action, safe_fallback, ACTION_SCHEMA)
from rl.evaluate_llm import summarize, rollout
from rl.snake_env import SnakeEnv


class LLMAgentTests(unittest.TestCase):
    def setUp(self):
        self.env = SnakeEnv()
        self.obs, _ = self.env.reset(seed=42)
        self.agent = LLMAgent()
        self.agent.client.verify_model = Mock(return_value={"local": True})
        self.agent.verify()

    def reply(self, content, **fields):
        self.agent.client.request = Mock(return_value={"message": {"content": content}, "done": True, **fields})
        return self.agent.choose_action(self.obs)

    def test_strict_action_contract(self):
        for name, action in (("STRAIGHT", 0), ("LEFT", 1), ("RIGHT", 2)):
            self.assertEqual(validate_action(json.dumps({"action": name})), action)
        for invalid in ('{}', '[]', 'null', '"LEFT"', '{"action":1}', '{"action":true}',
                        '{"action":"left"}', '{"action":"UP"}',
                        '{"action":"LEFT","extra":1}', '{"action":"LEFT","action":"RIGHT"}',
                        '```json\n{"action":"LEFT"}\n```', '{"action":"LEFT"} text', None):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_action(invalid)

    def test_state_mapping_all_food_directions_and_headings(self):
        for x, y, food in ((-1,-1,"upper_left"),(1,-1,"upper_right"),(-1,1,"lower_left"),
                           (1,1,"lower_right"),(0,-1,"upper"),(0,1,"lower"),(-1,0,"left"),
                           (1,0,"right"),(0,0,"same_cell")):
            for direction, heading in enumerate(("up", "right", "down", "left")):
                obs = self.obs.copy(); obs[7:9] = x, y; obs[3:7] = 0; obs[3 + direction] = 1
                result = structured_state(obs)
                self.assertEqual(result["food_direction"], food)
                self.assertEqual(result["current_direction"], heading)
                self.assertEqual(len(result), 5)
        with self.assertRaises(ValueError):
            structured_state(np.zeros(9))

    def test_payload_is_text_only_and_constrained(self):
        self.assertEqual(self.reply('{"action":"LEFT"}'), 1)
        args, kwargs = self.agent.client.request.call_args
        self.assertEqual(args[0], "/api/chat")
        payload = args[1]
        self.assertFalse(payload["stream"]); self.assertFalse(payload["think"])
        self.assertEqual(payload["format"], ACTION_SCHEMA)
        self.assertEqual(payload["options"]["temperature"], 0)
        self.assertEqual(len(payload["messages"]), 2)
        self.assertTrue(all(set(m) == {"role", "content"} for m in payload["messages"]))
        self.assertEqual(json.loads(payload["messages"][1]["content"]), structured_state(self.obs))

    def test_invalid_response_uses_safe_fallback(self):
        self.obs[:3] = [1, 0, 1]
        self.assertEqual(self.reply('{"action":"BACKWARD"}'), 1)
        self.assertTrue(self.agent.last_decision["invalid_response"])
        self.assertTrue(self.agent.last_decision["fallback"])
        self.assertFalse(self.agent.last_decision["request_error"])
        self.obs[:3] = [1, 1, 0]
        self.assertEqual(safe_fallback(self.obs), 2)
        self.obs[:3] = 1
        self.assertEqual(safe_fallback(self.obs), 0)

    def test_valid_dangerous_action_is_not_silently_corrected(self):
        self.obs[:3] = [1, 0, 0]
        self.assertEqual(self.reply('{"action":"STRAIGHT"}'), 0)
        self.assertFalse(self.agent.last_decision["fallback"])
        self.assertTrue(self.agent.last_decision["dangerous_action"])

    def test_request_failure_and_timeout_are_separate_from_invalid_output(self):
        self.obs[:3] = [1, 1, 0]
        for error in (TimeoutError("timeout"), urllib.error.URLError("offline"), ValueError("API error")):
            self.agent.client.request = Mock(side_effect=error)
            self.assertEqual(self.agent.choose_action(self.obs, timeout=.2), 2)
            self.assertTrue(self.agent.last_decision["request_error"])
            self.assertFalse(self.agent.last_decision["invalid_response"])
            self.assertEqual(self.agent.client.request.call_args.kwargs["timeout"], .2)

    def test_incomplete_response_is_invalid_even_with_valid_json(self):
        for fields in ({"done": False}, {"done_reason": "length"}):
            self.reply('{"action":"LEFT"}', **fields)
            self.assertTrue(self.agent.last_decision["invalid_response"])

    def test_remote_urls_proxies_and_redirects_forbidden(self):
        for url in ("https://ollama.com", "http://example.com", "http://localhost:11434",
                    "http://127.0.0.1.evil.test", "http://127.0.0.1@evil.test",
                    "http://127.0.0.1/api", "http://127.0.0.1?redirect=x"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                OllamaClient(url)
        OllamaClient("http://[::1]:11434")
        with self.assertRaises(urllib.error.URLError):
            NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com")

    def test_model_must_be_installed_locally(self):
        client = OllamaClient(); client.request = Mock(return_value={"models": []})
        with self.assertRaises(ValueError): client.verify_model("qwen:cloud")
        client.request.assert_not_called()
        with self.assertRaises(ValueError): client.verify_model("missing")
        client.request = Mock(side_effect=[{"models": [{"name": "remote"}]},
                                         {"remote_host": "https://example.com", "details": {"format": "gguf"}}])
        with self.assertRaises(ValueError): client.verify_model("remote")
        with self.assertRaises(RuntimeError): LLMAgent().choose_action(self.obs)

    def test_partial_episodes_excluded_from_score_but_failures_counted(self):
        records = [{"complete": True, "score": 10, "steps_survived": 5},
                   {"complete": False, "score": 100, "steps_survived": 100}]
        decisions = [{"latency_ms": 10, "request_error": False, "invalid_response": True,
                      "fallback": True, "dangerous_action": False},
                     {"latency_ms": 30, "request_error": True, "invalid_response": False,
                      "fallback": True, "dangerous_action": False}]
        stats = summarize(records, decisions)
        self.assertEqual(stats["mean_score"], 10)
        self.assertEqual(stats["partial_episodes"], 1)
        self.assertEqual(stats["mean_latency_ms"], 20)
        self.assertEqual(stats["invalid_action_rate"], 1)
        self.assertEqual(stats["request_error_rate"], .5)
        self.assertIsNone(summarize([], [])["mean_score"])

    def test_decision_finishing_after_budget_is_logged_but_not_executed(self):
        self.agent.client.request = Mock(return_value={"message": {"content": '{"action":"LEFT"}'}, "done": True})
        with tempfile.TemporaryDirectory() as temp, patch("rl.evaluate_llm.time") as clock:
            # Episode starts; remaining time; action starts; action returns late;
            # final deadline check. LLMAgent itself still uses the real clock.
            clock.perf_counter.side_effect = [0., 0., 0., 2., 2.]
            rows, decisions = rollout("late", self.agent, 1, 42, {}, 100,
                                      Path(temp), deadline=1.)
        self.assertTrue(rows[0]["budget_cut"])
        self.assertFalse(rows[0]["complete"])
        self.assertEqual(rows[0]["steps"], 0)
        self.assertEqual(len(decisions), 1)
        self.assertFalse(decisions[0]["executed"])
        self.assertEqual(rows[0]["end_reason"], "wall_time_budget")

    def test_rollout_writes_caps_and_expired_budget_does_not_call_policy(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp)
            policy = Mock(return_value=0)
            records, decisions = rollout("test", policy, 2, 42, {}, 2, out)
            self.assertEqual(len(records), 2)
            self.assertTrue(all(r["truncated"] and r["complete"] for r in records))
            self.assertEqual(len(decisions), 4)
            self.assertEqual(len((out / "test_decisions.jsonl").read_text().splitlines()), 4)
            records, decisions = rollout("expired", policy, 2, 42, {}, 2, out, time.perf_counter() - 1)
            self.assertEqual(records, [])
            self.assertEqual(policy.call_count, 4)


if __name__ == "__main__":
    unittest.main()
