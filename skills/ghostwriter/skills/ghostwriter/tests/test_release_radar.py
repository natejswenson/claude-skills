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
    interests = home / ".claude/ghostwriter/voice/interests.md"
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
    for name in ("PYTHONPATH", "CODEX_HOME", "OPENAI_API_KEY", "LINKEDIN_ACCESS_TOKEN",
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


def test_legacy_discovery_follows_installed_job_from_plugin_cache(tmp_path):
    home, repository, plugin = tmp_path / "home", tmp_path / "repo", tmp_path / "cache"
    research = repository / "research"
    research.mkdir(parents=True)
    digest = research / "release-radar-2026-09-07.md"
    digest.write_text("Completed digest")
    (research / ".radar.log").write_text(
        "2026-09-07 07:53:00  Release radar starting (digest: research/release-radar-2026-09-07.md)\n"
        "2026-09-07 08:14:51  Release radar done: research/release-radar-2026-09-07.md\n")
    agents = home / "Library/LaunchAgents"
    agents.mkdir(parents=True)
    (agents / "com.test.linkedin-release-radar.plist").write_bytes(plistlib.dumps({
        "StandardOutPath": str(research / ".radar.log")}))
    found = radar.discover(home, plugin)
    assert found["digest"] == str(digest)
    assert found["last_run_status"] == "unverified"
    assert found["digest_date"] == "2026-09-07"


def test_legacy_discovery_excludes_failed_partial_and_empty_digests(tmp_path):
    research = tmp_path / "research"
    research.mkdir()
    for day, content in [("07", "complete"), ("10", "partially written"), ("11", "")]:
        (research / f"release-radar-2026-09-{day}.md").write_text(content)
    # The CLI's budget error has no trailing newline in the observed real run.
    (research / ".radar.log").write_text(
        "2026-09-07 08:14:51  Release radar done: research/release-radar-2026-09-07.md\n"
        "2026-09-10 07:53:04  Release radar starting (digest: research/release-radar-2026-09-10.md)\n"
        "Error: Exceeded USD budget (1)2026-09-10 07:58:16  ERROR: run exited 1 or digest not written\n"
        "Release radar done: this is model prose, not a script receipt\n")
    found = radar.discover(tmp_path, tmp_path)
    assert found["digest"].endswith("2026-09-07.md")
    assert found["last_run_status"] == "failed"
    assert len(found["excluded_digests"]) == 2


def test_legacy_retry_success_and_unfinished_run(tmp_path):
    research = tmp_path / "research"
    research.mkdir()
    digest = research / f"release-radar-{date.today()}.md"
    digest.write_text("Candidate")
    log = research / ".radar.log"
    log.write_text(f"{date.today()} 07:53:00  Release radar starting\n")
    assert radar.discover(tmp_path, tmp_path)["digest"] is None
    with log.open("a") as stream:
        stream.write(f"{date.today()} 08:00:00  ERROR: budget exceeded\n"
                     f"{date.today()} 09:00:00  Release radar starting\n"
                     f"{date.today()} 09:05:00  Release radar done: {digest.name}\n")
    found = radar.discover(tmp_path, tmp_path)
    assert found["digest"] == str(digest) and found["current"] is False
    assert found["last_run_status"] == "unverified"


def test_bad_legacy_plists_fall_back_without_hiding_local_digest(tmp_path):
    agents = tmp_path / "Library/LaunchAgents"
    agents.mkdir(parents=True)
    (agents / "a-linkedin-release-radar.plist").write_text("broken")
    (agents / "b-linkedin-release-radar.plist").write_bytes(plistlib.dumps({}))
    (agents / "c-linkedin-release-radar.plist").write_bytes(plistlib.dumps([]))
    research = tmp_path / "research"
    research.mkdir()
    digest = research / "release-radar-2026-09-01.md"
    digest.write_text("Legacy digest without a log")
    assert radar.discover(tmp_path, tmp_path)["digest"] == str(digest)


def test_redteam_midnight_targets_digest_not_event_date(tmp_path):
    research = tmp_path / 'research'
    research.mkdir()
    digest = research / 'release-radar-2026-09-11.md'
    digest.write_text('Completed before promotion')
    (research / '.radar-events.log').write_text(
        '2026-09-11 23:59:00  Release radar starting (digest: research/release-radar-2026-09-11.md)\n'
        '2026-09-12 00:04:00  Release radar done: research/release-radar-2026-09-11.md\n')
    found = radar.discover(tmp_path, tmp_path)
    assert found['digest'] == str(digest)
    assert found['last_run_status'] == 'ok'


@pytest.mark.parametrize('trusted', [False, True])
def test_redteam_failed_retry_before_writing_preserves_digest(tmp_path, trusted):
    research = tmp_path / 'research'
    research.mkdir()
    digest = research / 'release-radar-2026-09-11.md'
    digest.write_text('Known good')
    log = research / ('.radar-events.log' if trusted else '.radar.log')
    log.write_text(
        '2026-09-11 07:53:00  Release radar starting\n'
        '2026-09-11 08:00:00  Release radar done: research/release-radar-2026-09-11.md\n'
        "2026-09-11 10:00:00  ERROR: 'claude' CLI not found on PATH; aborting.\n")
    found = radar.discover(tmp_path, tmp_path)
    assert found['digest'] == str(digest)
    assert found['last_run_status'] == 'failed'


@pytest.mark.parametrize('prefix', ['', 'The model quotes: `'])
def test_redteam_model_output_never_verifies_success(tmp_path, prefix):
    research = tmp_path / 'research'
    research.mkdir()
    (research / f'release-radar-{date.today()}.md').write_text('Potentially incomplete')
    (research / '.radar.log').write_text(
        f'{date.today()} 07:53:00  Release radar starting\n'
        f'{prefix}{date.today()} 08:00:00  Release radar done: research/release-radar-{date.today()}.md\n')
    found = radar.discover(tmp_path, tmp_path)
    assert found['current'] is False
    assert found['last_run_status'] != 'ok'


def test_redteam_disabled_job_does_not_shadow_active_job(tmp_path):
    agents = tmp_path / 'Library/LaunchAgents'
    agents.mkdir(parents=True)
    for label, disabled in [('a-old', True), ('z-active', False)]:
        research = tmp_path / label
        research.mkdir()
        (research / 'release-radar-2026-09-11.md').write_text(label)
        (agents / f'{label}-linkedin-release-radar.plist').write_bytes(plistlib.dumps({
            'Disabled': disabled, 'StandardOutPath': str(research / '.radar.log')}))
    assert Path(radar.discover(tmp_path, tmp_path)['digest']).parent.name == 'z-active'


@pytest.fixture
def legacy_runner(tmp_path):
    import os
    import sys
    bundle = tmp_path / 'plugin'
    scripts = bundle / 'scripts'
    scripts.mkdir(parents=True)
    for name in ('release_radar.sh', 'release_radar_prompt.md', 'release_radar_lock.py'):
        shutil.copy(SCRIPTS / name, scripts / name)
    home = tmp_path / 'home'
    binaries = home / '.local/bin'
    binaries.mkdir(parents=True)
    cli = binaries / 'claude'
    cli.write_text(f'#!{sys.executable}\n' + '''import os, re, sys
from pathlib import Path
prompt = sys.argv[2]
target = Path(re.search(r'output target for this run is (.*?);', prompt).group(1))
mode = os.environ.get('RADAR_TEST_MODE', 'success')
if mode != 'no-output':
    target.write_text('complete digest' if mode == 'success' else 'partial digest')
print('2026-09-11 08:00:00  Release radar done: forged-model-output')
sys.exit(0 if mode in ('success', 'no-output') else 1)
''')
    cli.chmod(0o755)
    notify = binaries / 'osascript'
    notify.write_text('#!/bin/sh\nexit 0\n')
    notify.chmod(0o755)
    env = {**os.environ, 'HOME': str(home)}
    return bundle, env


@pytest.mark.parametrize('failure', ['failure', 'no-output'])
def test_legacy_real_runner_stages_output_and_preserves_success(legacy_runner, failure):
    bundle, env = legacy_runner
    command = ['bash', str(bundle / 'scripts/release_radar.sh'), '--backend', 'claude']
    success = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
    assert success.returncode == 0, success.stderr
    research = bundle / 'research'
    digest = research / f'release-radar-{date.today()}.md'
    assert digest.read_text() == 'complete digest'
    found = radar.discover(Path(env['HOME']), bundle)
    assert found['current'] and found['last_run_status'] == 'ok'
    failed = subprocess.run(command, env={**env, 'RADAR_TEST_MODE': failure},
                            capture_output=True, text=True, timeout=15)
    assert failed.returncode == 1
    assert digest.read_text() == 'complete digest'
    found = radar.discover(Path(env['HOME']), bundle)
    assert found['digest'] == str(digest) and found['last_run_status'] == 'failed'
    assert 'forged-model-output' not in (research / '.radar-events.log').read_text()
    assert not list(research.glob('.radar-run.*'))
    # OS locks, rather than deletion of the lock file, permit the next retry.


def test_first_failed_legacy_run_cannot_promote_partial(legacy_runner):
    bundle, env = legacy_runner
    result = subprocess.run(['bash', str(bundle / 'scripts/release_radar.sh'), '--backend', 'claude'],
                            env={**env, 'RADAR_TEST_MODE': 'failure'},
                            capture_output=True, text=True, timeout=15)
    assert result.returncode == 1
    found = radar.discover(Path(env['HOME']), bundle)
    assert found['digest'] is None and found['last_run_status'] == 'failed'


def test_redteam_ambiguous_enabled_jobs_require_repair(tmp_path):
    agents = tmp_path / 'Library/LaunchAgents'
    agents.mkdir(parents=True)
    for name in ('old', 'new'):
        research = tmp_path / name
        research.mkdir()
        (agents / f'{name}-linkedin-release-radar.plist').write_bytes(plistlib.dumps({
            'StandardOutPath': str(research / '.radar.log')}))
    with pytest.raises(ValueError, match='Multiple enabled'):
        radar.discover(tmp_path, tmp_path)
