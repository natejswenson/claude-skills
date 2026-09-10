"""Durable Codex radar contracts; all offline tests are credential-free."""
from pathlib import Path
from datetime import date
import json
import plistlib
import shutil
import subprocess
from types import SimpleNamespace
from urllib.error import HTTPError, URLError

import pytest
import release_radar_runtime as radar
import release_radar_fetch as sources

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def test_launcher_dispatches_explicit_codex_backend():
    assert '--backend' in (SCRIPTS / 'release_radar.sh').read_text()


def test_installer_preserves_backend_on_repair():
    assert 'release_radar_runtime.py' in (SCRIPTS / 'install_radar.sh').read_text()


def test_interactive_flow_discovers_durable_digest():
    text = (SCRIPTS.parent / 'SKILL.md').read_text()
    assert 'release_radar_runtime.py discover' in text


@pytest.fixture
def installed(tmp_path, monkeypatch):
    home = tmp_path / "home"
    interests = home / ".claude/ghostwriter-x/voice/interests.md"
    interests.parent.mkdir(parents=True)
    interests.write_text("Build reproducible coding tools.")
    monkeypatch.setattr(radar.subprocess, "run", lambda *a, **k: SimpleNamespace(
        returncode=0, stdout=" ".join(radar.FLAGS)))
    config = radar.install(SCRIPTS, home, executable="/usr/bin/true", load_agent=False)
    return Path(config["root"]) / "trusted", config


def receipt_files(destination, body=b"Primary release details"):
    destination.mkdir(parents=True, exist_ok=True)
    receipt = {"source": sources.SOURCES[0], "final_url": sources.SOURCES[0],
               "status": 200, "retrieved_at": "2026-09-09T10:00:00+00:00",
               "snapshot": "source-0.json", "bytes": len(body),
               "sha256": sources.sha256(body),
               "evidence": body[:sources.EVIDENCE_BYTES].decode("utf-8", errors="replace")}
    (destination / receipt["snapshot"]).write_bytes(body)
    radar.write_json(destination / "receipts.json", [receipt])
    return [receipt]


def candidate_text():
    return f"# Release radar — {date.today().isoformat()}\n\nChecked [source]({sources.SOURCES[0]})."


def test_install_durable_and_repair(installed, monkeypatch, tmp_path):
    trusted, config = installed
    # Only fixture-owned legacy files; no edits to another session's real digest.
    bundle = tmp_path / "bundle"
    shutil.copytree(SCRIPTS, bundle)
    legacy = bundle.parent / "research"
    legacy.mkdir()
    old_digest = legacy / "release-radar-2001-01-01.md"
    old_digest.write_text("Legacy digest survives")
    calls = []
    def invoke(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout=" ".join(radar.FLAGS))
    monkeypatch.setattr(radar.subprocess, "run", invoke)
    repaired = radar.install(bundle, Path(config["home"]))
    assert repaired == config
    assert old_digest.read_text() == "Legacy digest survives"
    agent = plistlib.loads(Path(config["plist"]).read_bytes())
    assert agent["ProgramArguments"][1:] == ["-I", str(trusted / "release_radar_runtime.py"), "run"]
    assert agent["WorkingDirectory"] == str(trusted)
    assert agent["StandardOutPath"] == agent["StandardErrorPath"] == str(trusted.parent / "data/.radar.log")
    assert agent["StartCalendarInterval"] == [{"Weekday": d, "Hour": 7, "Minute": 53} for d in (1, 4)]
    assert str(bundle) not in json.dumps(agent)
    assert calls[-3:] == [["launchctl", "unload", config["plist"]],
                          ["launchctl", "load", "-w", config["plist"]],
                          ["launchctl", "list", config["label"]]]
    assert radar.verify_trusted(trusted) == config
    assert radar.install(trusted, Path(config["home"]), load_agent=False) == config


def test_environment_drops_inherited_policy_and_posting_secrets(installed, monkeypatch):
    _, config = installed
    for name in ("PYTHONPATH", "CODEX_HOME", "OPENAI_API_KEY", "TYPEFULLY_API_KEY",
                 "HTTP_PROXY", "CODEX_SANDBOX_NETWORK_DISABLED"):
        monkeypatch.setenv(name, "hostile")
    env = radar.environment(config)
    assert set(env) == {"HOME", "CODEX_HOME", "PATH", "LANG"}
    assert env["CODEX_HOME"] == config["codex_home"]
    command = radar.codex_command(config, Path("/trusted/candidate.md"))
    assert command == [config["executable"], "exec", "--sandbox", "read-only",
                       "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check",
                       "--ephemeral", "--json", "--output-last-message", "/trusted/candidate.md", "-"]


@pytest.mark.parametrize("result", [
    SimpleNamespace(returncode=1, stdout=" ".join(radar.FLAGS)),
    SimpleNamespace(returncode=0, stdout="--sandbox"),
])
def test_preflight_fails_closed(result, monkeypatch):
    monkeypatch.setattr(radar.subprocess, "run", lambda *a, **k: result)
    with pytest.raises(ValueError, match="upgrade Codex"):
        radar.preflight("codex", {})


def test_install_missing_cli_and_unsafe_roots(tmp_path, monkeypatch):
    monkeypatch.setattr(radar.shutil, "which", lambda _: None)
    with pytest.raises(ValueError, match="CLI not found"):
        radar.install(SCRIPTS, tmp_path)
    monkeypatch.setattr(radar, "preflight", lambda *a: None)
    with pytest.raises(ValueError, match="outside"):
        radar.install(tmp_path, tmp_path, executable="/bin/true")
    with pytest.raises(ValueError, match="outside"):
        radar.install(SCRIPTS, tmp_path, executable=str(radar.root_for(tmp_path) / "data/codex"))
    with pytest.raises(ValueError, match="outside"):
        radar.install(SCRIPTS, tmp_path, executable=str(SCRIPTS.parent / ".venv/codex"))
    monkeypatch.setattr(radar.sys, "executable", str(SCRIPTS.parent / ".venv/python"))
    with pytest.raises(ValueError, match="outside"):
        radar.install(SCRIPTS, tmp_path, executable="/bin/true")


def test_explicit_inputs_and_cli_resolution(installed, tmp_path, monkeypatch):
    _, config = installed
    interests = tmp_path / "chosen.md"
    interests.write_text("Explicit interests")
    monkeypatch.setattr(radar.shutil, "which", lambda _: "/bin/true")
    another_home = tmp_path / "other-home"
    result = radar.install(SCRIPTS, another_home, interests=interests,
                          codex_home=tmp_path / "auth", label="com.example.radar-probe", load_agent=False)
    assert result["interests"] == str(interests)
    assert result["codex_home"] == str(tmp_path / "auth")
    assert result["label"] == "com.example.radar-probe"


def test_symlink_and_bounded_input(tmp_path):
    link = tmp_path / "link"
    link.symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError, match="Symlink"):
        radar.safe_path(link / "nested")
    file = tmp_path / "input"
    for content in ("", "too large"):
        file.write_text(content)
        with pytest.raises(ValueError, match="empty or too large"):
            radar.bounded_text(file, 3)
    file.write_text("ok")
    assert radar.bounded_text(file, 3) == "ok"


@pytest.mark.parametrize("target", [*radar.ASSETS, "install.json", "plist"])
def test_trusted_tampering_blocks_launch(installed, target):
    trusted, config = installed
    file = Path(config["plist"]) if target == "plist" else trusted / target
    file.write_text(file.read_text() + "\n")
    with pytest.raises(ValueError, match="Trusted runtime changed"):
        radar.verify_trusted(trusted)


def test_incomplete_hash_manifest_and_wrong_backend(installed):
    trusted, config = installed
    hashes = radar.read_json(trusted / "hashes.json")
    radar.write_json(trusted / "hashes.json", {})
    with pytest.raises(ValueError, match="Invalid trusted"):
        radar.verify_trusted(trusted)
    radar.write_json(trusted / "hashes.json", hashes)
    config["backend"] = "claude"
    radar.write_json(trusted / "install.json", config)
    with pytest.raises(ValueError, match="Invalid trusted"):
        radar.verify_trusted(trusted)


class Response:
    status = 200
    def __init__(self, body=b"Primary source"):
        self.body = body
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass
    def geturl(self):
        return sources.SOURCES[0]
    def read(self, maximum):
        assert maximum == sources.MAX_BYTES + 1
        return self.body


def mock_opener(monkeypatch, response):
    def open_source(request, timeout):
        assert request.full_url == sources.SOURCES[0]
        assert timeout == 30
        assert not request.has_header("Authorization")
        if isinstance(response, Exception):
            raise response
        return response
    monkeypatch.setattr(sources, "build_opener", lambda *a: SimpleNamespace(open=open_source))


def test_fetch_live_receipt_contract(tmp_path, monkeypatch):
    mock_opener(monkeypatch, Response())
    receipts = sources.fetch({"sources": list(sources.SOURCES)}, tmp_path)
    sources.validate(receipts, tmp_path)
    assert receipts[0]["status"] == 200
    assert receipts[0]["sha256"] == sources.sha256(b"Primary source")
    assert radar.read_json(tmp_path / "receipts.json") == receipts
    with pytest.raises(ValueError, match="Unrecognized"):
        sources.fetch({"sources": ["https://untrusted.invalid"]}, tmp_path)
    with pytest.raises(ValueError, match="redirected"):
        sources.NoRedirect().redirect_request(None, None, 302, "", {}, "https://untrusted.invalid")


@pytest.mark.parametrize("response", [
    URLError("offline"), HTTPError(sources.SOURCES[0], 403, "Denied", {}, None),
    ValueError("redirect"), Response(b""), Response(b"x" * (sources.MAX_BYTES + 1)),
])
def test_fetch_unavailable_records_failure(tmp_path, monkeypatch, response):
    mock_opener(monkeypatch, response)
    with pytest.raises(ValueError, match="Failed or malformed"):
        sources.fetch({"sources": list(sources.SOURCES)}, tmp_path)
    receipts = radar.read_json(tmp_path / "receipts.json")
    assert receipts[0]["error"]
    assert "sha256" not in receipts[0]


@pytest.mark.parametrize("field,value", [("status", 500), ("geturl", lambda: "https://untrusted.invalid")])
def test_fetch_rejects_response_mismatch(tmp_path, monkeypatch, field, value):
    response = Response()
    setattr(response, field, value)
    mock_opener(monkeypatch, response)
    with pytest.raises(ValueError, match="Failed or malformed"):
        sources.fetch({"sources": list(sources.SOURCES)}, tmp_path)


@pytest.mark.parametrize("mutation", [
    lambda r: r.clear(), lambda r: r.append({}), lambda r: r.__setitem__(0, "bad"),
    lambda r: r[0].pop("source"), lambda r: r[0].update(status=500),
    lambda r: r[0].update(final_url="https://bad.invalid"),
    lambda r: r[0].update(snapshot="../outside"), lambda r: r[0].pop("retrieved_at"),
    lambda r: r[0].update(retrieved_at="not-a-date"),
    lambda r: r[0].update(retrieved_at="2026-09-09T10:00:00"),
    lambda r: r[0].update(retrieved_at=True),
    lambda r: r[0].update(sha256="0" * 64), lambda r: r[0].update(evidence="forged"),
    lambda r: r[0].update(bytes=0),
])
def test_invalid_receipts_fail_even_with_candidate(tmp_path, mutation):
    receipts = receipt_files(tmp_path)
    candidate = tmp_path / "candidate.md"
    candidate.write_text(candidate_text())
    mutation(receipts)
    with pytest.raises(ValueError):
        radar.promote(candidate, tmp_path, receipts, tmp_path / "promoted.md")
    assert not (tmp_path / "promoted.md").exists()


def test_promotion_validates_snapshots_receipts_and_citations(tmp_path):
    receipts = receipt_files(tmp_path)
    candidate = tmp_path / "candidate.md"
    candidate.write_text(candidate_text())
    radar.write_json(tmp_path / "receipts.json", [])
    with pytest.raises(ValueError, match="receipts changed"):
        radar.promote(candidate, tmp_path, receipts, tmp_path / "digest.md")
    radar.write_json(tmp_path / "receipts.json", receipts)
    for text in ("# wrong date", candidate_text() + " https://unverified.invalid"):
        candidate.write_text(text)
        with pytest.raises(ValueError, match="verified source"):
            radar.promote(candidate, tmp_path, receipts, tmp_path / "digest.md")
    candidate.write_text(candidate_text())
    radar.promote(candidate, tmp_path, receipts, tmp_path / "digest.md")
    assert (tmp_path / "digest.md").read_text() == candidate_text()
    (tmp_path / "source-0.json").unlink()
    with pytest.raises(OSError):
        radar.promote(candidate, tmp_path, receipts, tmp_path / "digest.md")


def test_run_stages_retrieves_captures_and_promotes(installed, monkeypatch):
    trusted, config = installed
    prior = trusted.parent / "data/digests/release-radar-2000-01-01.md"
    prior.write_text("Prior digest for deduplication")
    monkeypatch.setattr(sources, "fetch", lambda policy, destination: receipt_files(destination))
    def invoke(args, **kwargs):
        if "--help" in args:
            return SimpleNamespace(returncode=0, stdout=" ".join(radar.FLAGS))
        workspace = kwargs["cwd"]
        candidate = Path(args[args.index("--output-last-message") + 1])
        assert candidate.is_relative_to(trusted / "runs")
        assert workspace.is_relative_to(trusted.parent / "data/runs")
        assert "Prior digest for deduplication" in kwargs["input"]
        assert "Build reproducible coding tools." in kwargs["input"]
        assert (workspace / "interests.md").read_text() == "Build reproducible coding tools."
        candidate.write_text(candidate_text())
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(radar.subprocess, "run", invoke)
    digest = radar.run(trusted)
    assert digest.read_text() == candidate_text()
    assert digest.parent == trusted.parent / "data/digests"
    assert list((trusted / "runs").glob("*/receipts.json"))


def test_run_failure_does_not_promote(installed, monkeypatch):
    trusted, _ = installed
    monkeypatch.setattr(sources, "fetch", lambda policy, destination: receipt_files(destination))
    monkeypatch.setattr(radar, "preflight", lambda *a: None)
    monkeypatch.setattr(radar.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=1))
    with pytest.raises(ValueError, match="Codex failed"):
        radar.run(trusted)
    assert not list((trusted.parent / "data/digests").iterdir())


@pytest.mark.parametrize("failure", ["missing", "status", "hash", "offline"])
def test_run_bad_retrieval_never_launches_model(installed, monkeypatch, failure):
    trusted, _ = installed
    monkeypatch.setattr(radar, "preflight", lambda *a: None)
    def fetch(policy, workspace):
        receipts = receipt_files(workspace)
        if failure == "offline":
            raise ValueError("Source offline")
        if failure == "missing":
            return []
        if failure == "status":
            receipts[0]["status"] = 500
        else:
            receipts[0]["sha256"] = "forged"
        return receipts
    def unexpected(*args, **kwargs):
        pytest.fail("Model must not launch without a valid live receipt")
    monkeypatch.setattr(sources, "fetch", fetch)
    monkeypatch.setattr(radar.subprocess, "run", unexpected)
    with pytest.raises(ValueError):
        radar.run(trusted)
    assert not list((trusted.parent / "data/digests").iterdir())


@pytest.mark.parametrize("legacy_state", ["absent", "stale"])
def test_discovery_prefers_configured_durable_digest(installed, tmp_path, legacy_state):
    trusted, config = installed
    legacy = tmp_path / "plugin"
    if legacy_state == "stale":
        (legacy / "research").mkdir(parents=True)
        (legacy / "research/release-radar-2000-01-01.md").write_text("stale")
    digest = trusted.parent / "data/digests" / f"release-radar-{date.today()}.md"
    digest.write_text("Fresh durable digest")
    log = trusted.parent / "data/.radar.log"
    log.write_text("OK\n")
    found = radar.discover(Path(config["home"]), legacy)
    assert found["digest"] == str(digest)
    assert found["backend"] == "codex"
    assert found["health"] == log.read_text()
    assert found["root"] == config["root"]


def test_discovery_legacy_fallback(tmp_path):
    result = radar.discover(tmp_path, tmp_path)
    assert result["backend"] == "claude"
    assert result["digest"] is None
    assert result["health"] == "No run log"


def test_shell_codex_dispatch_and_repair_without_claude(tmp_path):
    home = tmp_path / "home"
    trusted = radar.root_for(home) / "trusted"
    trusted.mkdir(parents=True)
    (trusted / "install.json").write_text('{"backend":"codex"}')
    (trusted / "release_radar_runtime.py").write_text(
        "import sys; print('durable Codex ' + ' '.join(sys.argv[1:]))")
    tools = tmp_path / "bin"
    tools.mkdir()
    tools.joinpath("python3").symlink_to(shutil.which("python3"))
    env = {"HOME": str(home), "PATH": str(tools) + ":/usr/bin:/bin"}
    assert shutil.which("claude", path=env["PATH"]) is None
    for args in ([], ["--backend", "codex"]):
        result = subprocess.run(["/bin/bash", str(SCRIPTS / "release_radar.sh"), *args],
                                env=env, capture_output=True, text=True)
        assert result.returncode == 0
        assert result.stdout.strip() == "durable Codex run"
    invalid = subprocess.run(["/bin/bash", str(SCRIPTS / "release_radar.sh"),
                              "--backend", "unknown"], env=env, capture_output=True, text=True)
    assert invalid.returncode == 2 and "expected --backend" in invalid.stderr
    # The installer dispatches explicitly to the current bundle for repair.
    bundle = tmp_path / "skill/scripts"
    bundle.mkdir(parents=True)
    shutil.copyfile(SCRIPTS / "install_radar.sh", bundle / "install_radar.sh")
    (bundle / "release_radar_runtime.py").write_text(
        "import sys; print('repair Codex ' + ' '.join(sys.argv[1:]))")
    repair = subprocess.run(["/bin/bash", str(bundle / "install_radar.sh")],
                            env=env, capture_output=True, text=True)
    assert repair.returncode == 0 and repair.stdout.strip() == "repair Codex install"


def test_main_install_discover_run_and_failures(installed, monkeypatch, capsys):
    trusted, config = installed
    monkeypatch.setattr(radar.Path, "home", lambda: Path(config["home"]))
    assert radar.main(["install", "--backend", "codex", "--no-load"]) == 0
    capsys.readouterr()
    assert radar.main(["discover"]) == 0
    assert json.loads(capsys.readouterr().out)["backend"] == "codex"
    monkeypatch.setattr(radar, "run", lambda path: path.parent / "data/digests/digest.md")
    assert radar.main(["run"]) == 0
    assert capsys.readouterr().out.strip() == "OK"
    monkeypatch.setattr(radar, "__file__", str(trusted / "release_radar_runtime.py"))
    assert radar.main(["run"]) == 0
    def fail(path):
        raise ValueError("bad receipt")
    monkeypatch.setattr(radar, "run", fail)
    assert radar.main(["run"]) == 1
    error = capsys.readouterr().err
    assert error.strip() == "ERROR: ValueError"
    assert "bad receipt" not in error
    assert "ERROR: ValueError" in (trusted.parent / "data/.radar.log").read_text()
