"""Loopback-only static frontend, DQN/Ollama inference and isolated training jobs."""
import argparse
import json
import mimetypes
from pathlib import Path
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote
import uuid
import webbrowser
from datetime import datetime
from rl.model_profiles import model_profile, normalize_profile, inference_rules

import torch

from rl.snake_env import SnakeEnv
from rl.llm_agent import LLMAgent
from rl.dqn.agent import DQNAgent
from rl.dqn.train_session import write_json

ROOT = Path(__file__).resolve().parents[1]
HEADINGS = ("UP", "RIGHT", "DOWN", "LEFT")


def model_path(models, name):
    if not isinstance(name, str) or not name or len(name) > 240:
        raise ValueError("Select a model")
    path = (models / name).resolve()
    if not path.is_relative_to(models.resolve()) or path.suffix != ".pt" or not path.is_file():
        raise ValueError("Model must be an existing .pt file inside models")
    return path


def observation_from_snapshot(state):
    """Validate a browser snapshot and use the existing Python observation rules."""
    if not isinstance(state, dict) or state.get("size") != 20:
        raise ValueError("Expected a 20x20 board")
    snake = state.get("snake")
    if not isinstance(snake, list) or not 1 <= len(snake) <= 400:
        raise ValueError("Invalid snake")
    def point(p):
        if (not isinstance(p, dict) or type(p.get("x")) is not int or type(p.get("y")) is not int
                or not 0 <= p["x"] < 20 or not 0 <= p["y"] < 20):
            raise ValueError("Invalid board coordinate")
        return p["x"], p["y"]
    body = [point(p) for p in snake]
    if len(set(body)) != len(body) or any(abs(a[0]-b[0])+abs(a[1]-b[1]) != 1 for a,b in zip(body, body[1:])):
        raise ValueError("Snake must be contiguous and non-overlapping")
    direction = state.get("direction", {})
    heading = (direction.get("x"), direction.get("y"))
    if heading not in SnakeEnv.DIRECTIONS:
        raise ValueError("Invalid heading")
    if len(body) > 1 and (body[0][0]-body[1][0], body[0][1]-body[1][1]) != heading:
        raise ValueError("Heading must point away from the neck")
    food = point(state.get("food"))
    if food in body or state.get("alive") is not True:
        raise ValueError("Expected a live board with unoccupied food")
    no_food = state.get("stepsSinceFood", 0)
    if type(no_food) is not int or not 0 <= no_food <= 100000000:
        raise ValueError("Invalid no-food counter")
    env = SnakeEnv()
    env.snake, env.food, env.direction = body, food, SnakeEnv.DIRECTIONS.index(heading)
    env.steps_since_food = no_food
    return env._observation(), env.direction


class LocalApp:
    def __init__(self, root=ROOT):
        self.root = Path(root).resolve()
        self.models = self.root / "models"
        self.lock, self.qwen_lock, self.training_lock = threading.Lock(), threading.Lock(), threading.Lock()
        self.cache = {}
        self.qwen = LLMAgent(timeout=60)
        self.process = self.job_dir = None

    def list_models(self):
        result = []
        for path in sorted(self.models.rglob("*.pt")):
            if not path.resolve().is_relative_to(self.models.resolve()): continue
            try:
                payload = torch.load(path, map_location="cpu", weights_only=True)
                if payload.get("format_version") not in (1, 2): continue
                result.append({"name": path.relative_to(self.models).as_posix(),
                               "episodes": payload.get("metadata", {}).get("episode", 0),
                               "resumable": "training_state" in payload,
                               "reward_profile": model_profile(payload.get('metadata', {}), path.relative_to(self.models).as_posix()),
                               "saved_at": payload.get('metadata', {}).get('saved_at') or datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat()})
            except Exception:
                continue
        return sorted(result, key=lambda row: (-row["episodes"], row["name"]))

    def browser_model(self, data):
        """Export inference weights only; checkpoint/replay files stay private."""
        path = model_path(self.models, data.get("model"))
        payload = torch.load(path, map_location="cpu", weights_only=True)
        config = payload.get("config", {})
        env_config = payload.get("metadata", {}).get("env_config", {})
        if (payload.get("format_version") not in (1, 2)
                or config.get("observation_size") != 10 or config.get("action_size") != 3
                or env_config.get("board_size", 20) != 20):
            raise ValueError("Browser inference requires a 20x20, 10-input, 3-action DQN")
        hidden = config.get("hidden_size")
        if type(hidden) is not int or not 1 <= hidden <= 1024:
            raise ValueError("Unsupported hidden layer size")
        layers = []
        for index, inputs, outputs in ((0, 10, hidden), (2, hidden, hidden), (4, hidden, 3)):
            weight = payload["online"][f"layers.{index}.weight"]
            bias = payload["online"][f"layers.{index}.bias"]
            if (tuple(weight.shape) != (outputs, inputs) or tuple(bias.shape) != (outputs,)
                    or not torch.isfinite(weight).all() or not torch.isfinite(bias).all()):
                raise ValueError("Invalid network weights")
            layers.append({"weights": weight.tolist(), "bias": bias.tolist()})
        # Match the existing /api/action observation contract (default SnakeEnv).
        exported = {"format": "snake-dqn-dense-v1", "board_size": 20,
                    "max_steps_without_food": 400, "layers": layers}
        rules = inference_rules(model_profile(payload.get('metadata', {}), path.relative_to(self.models).as_posix()))
        if rules.get("dense_board_sweep_above_half") is True:
            exported["inference_rules"] = {"dense_board_sweep_above_half": True}
        return exported

    def action(self, data):
        observation, direction = observation_from_snapshot(data.get("state"))
        started = time.perf_counter()
        if data.get("agent") == "dqn":
            path = model_path(self.models, data.get("model"))
            with self.lock:
                key = (str(path), path.stat().st_mtime_ns)
                if key not in self.cache:
                    agent, metadata = DQNAgent.load(path)
                    if metadata.get("env_config", {}).get("board_size", 20) != 20:
                        raise ValueError("Model board size does not match the browser")
                    agent.online.eval()
                    self.cache = {key: agent}
                action = self.cache[key].choose_action(observation, explore=False)
            details = {"fallback": False}
        elif data.get("agent") == "qwen":
            if not self.qwen_lock.acquire(blocking=False):
                raise RuntimeError("Qwen is busy; try again shortly")
            try:
                if not self.qwen.verified: self.qwen.verify()
                action = self.qwen.choose_action(observation)
                details = self.qwen.last_decision
            finally:
                self.qwen_lock.release()
        else:
            raise ValueError("Choose dqn or qwen")
        return {"action": HEADINGS[(direction + (0, -1, 1)[action]) % 4],
                "relative_action": action, "latency_ms": (time.perf_counter()-started)*1000,
                "fallback": details.get("fallback", False), "error": details.get("error")}

    def training_status(self):
        if self.job_dir is None: return {"state": "idle"}
        path = self.job_dir / "status.json"
        status = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"state": "starting"}
        if self.process and self.process.poll() is not None and status["state"] in ("running", "starting"):
            status.update(state="failed", error="Training process exited. See this job's worker.log.")
        return status

    def start_training(self, data):
        episodes, save_every = data.get("episodes"), data.get("save_every", 100)
        seed = data.get("seed", 42)
        if (type(episodes) is not int or not 1 <= episodes <= 10000 or type(save_every) is not int
                or not 1 <= save_every <= 10000 or type(seed) is not int or not 0 <= seed < 100000):
            raise ValueError("Episodes/save interval: 1..10000; seed: 0..99999")
        profile = data.get("reward_profile", "inherit")
        if profile != 'inherit': profile = normalize_profile(profile)
        source = model_path(self.models, data["model"]) if data.get("model") else None
        with self.training_lock:
            if self.process and self.process.poll() is None:
                raise RuntimeError("A training job is already running")
            job = time.strftime("%Y%m%d_%H%M%S_") + uuid.uuid4().hex[:6]
            self.job_dir = self.root / "results" / "training_runs" / job
            self.job_dir.mkdir(parents=True)
            command = [sys.executable, "-m", "rl.dqn.train_session", "--episodes", str(episodes),
                       "--job-dir", str(self.job_dir), "--models-dir", str(self.models),
                       "--save-every", str(save_every), "--seed", str(seed), "--reward-profile", profile]
            if source: command += ["--checkpoint", str(source)]
            write_json(self.job_dir / "request.json", data)
            with (self.job_dir / "worker.log").open("w", encoding="utf-8") as log:
                self.process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            return {"state": "starting", "job": job}

    def stop_training(self):
        with self.training_lock:
            if self.job_dir and self.process and self.process.poll() is None:
                (self.job_dir / "stop").touch()
                return {"state": "stopping"}
        return self.training_status()


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, data):
        content = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers(); self.wfile.write(content)

    def allowed(self):
        port = self.server.server_address[1]
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        return host in allowed and (origin is None or origin == "http://" + host)

    def do_GET(self):
        if not self.allowed(): return self.reply(403, {"error": "Use the local Snake page"})
        path = unquote(urlsplit(self.path).path)
        try:
            if path == "/api/models": return self.reply(200, {"models": self.server.app.list_models()})
            if path == "/api/training": return self.reply(200, self.server.app.training_status())
            if path == "/api/health":
                return self.reply(200, {"local": True, "project": "PixelSnake", "root": str(self.server.app.root)})
            relative = path.lstrip("/") or "index.html"
            if relative not in ("index.html", "PixelSnake.html") and not relative.startswith(("css/", "js/")):
                return self.reply(404, {"error": "Not found"})
            file = (self.server.app.root / relative).resolve()
            if (not file.is_relative_to(self.server.app.root.resolve()) or not file.is_file()
                    or file.suffix not in (".html", ".css", ".js")):
                return self.reply(404, {"error": "Not found"})
            content = file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] + "; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers(); self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError): pass
        except Exception as error: self.reply(500, {"error": str(error)})

    def do_POST(self):
        if (not self.allowed() or self.headers.get("X-Snake-Client") != "1"
                or self.headers.get("Content-Type", "").split(";")[0] != "application/json"):
            return self.reply(403, {"error": "Use the local Snake page"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 65536: raise ValueError("Invalid request size")
            self.connection.settimeout(70)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict): raise ValueError("Expected an object")
            routes = {"/api/action": self.server.app.action,
                      "/api/dqn/model": self.server.app.browser_model,
                      "/api/training/start": self.server.app.start_training,
                      "/api/training/stop": lambda _: self.server.app.stop_training()}
            if self.path not in routes: return self.reply(404, {"error": "Not found"})
            self.reply(200, routes[self.path](data))
        except (BrokenPipeError, ConnectionResetError): pass
        except (ValueError, KeyError, TypeError) as error: self.reply(400, {"error": str(error)})
        except Exception as error: self.reply(503, {"error": str(error)})

    def log_message(self, *_): pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(1)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as error:
        parser.exit(1, f"Cannot start PixelSnake on port {args.port}: {error}\n"
                       "Close the other service or run start-local.ps1 -Port 8766.\n")
    server.app = LocalApp()
    print(f"Pixel Snake: http://127.0.0.1:{args.port}", flush=True)
    if args.open_browser:
        webbrowser.open(f"http://127.0.0.1:{server.server_address[1]}")
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        server.app.stop_training()
        if server.app.process:
            server.app.process.wait(timeout=120)
        server.server_close()


if __name__ == "__main__":
    main()
