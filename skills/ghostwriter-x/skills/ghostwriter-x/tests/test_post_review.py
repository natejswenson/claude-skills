"""Review protocol tests; editorial quality still needs a real editor.

Synthetic attestations here test state transitions, not model quality scores.
"""
import json
import sys
from pathlib import Path

import pytest
import post_review as review

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parents[3]
OTHER = "ghostwriter-x" if ROOT.name == "ghostwriter" else "ghostwriter"
OTHER_ROOT = REPO / "skills" / OTHER / "skills" / OTHER
# Exercise both branches of the identical bundled module, using real helpers.
sys.path.append(str(OTHER_ROOT / "scripts"))
CLEAN = "I moved the check into the write path.\n\nThe next run stopped before saving the file."


def save(path, record):
    review.sidecar(path).write_text(json.dumps(record))


def reviewed(tmp_path, text=CLEAN, platform=None):
    platform = platform or review.PLATFORM
    path = tmp_path / "post.md"
    path.write_text(text)
    path.with_suffix(".sources.json").write_text('{"external_claims":false,"claims":[]}')
    voice = tmp_path / "voice.md"
    voice.write_text("Plain first-person narration. Explain what happened.")
    samples = tmp_path / "samples.md"
    samples.write_text("I moved the guard. The write stopped.\n\nI ran it twice. Both checks passed.")
    record = review.prepare(path, [voice], [samples], platform)
    record["reviewer"] = "session-editor"
    for key in review.RUBRIC:
        record["checks"][key] = dict(status="pass", quote=text.splitlines()[0],
                                     reason=f"Synthetic attestation for {key}; tests protocol only.")
    for key in review.COMPARISONS:
        record["comparisons"][key] = dict(status="pass", quote=text.splitlines()[0],
                                          alternative="A different synthetic opening." if key == "opening" else "[delete]",
                                          reason=f"Synthetic {key} comparison; tests protocol only.")
    save(path, record)
    return path, record, voice, samples


def test_bundled_review_and_reference_are_identical():
    for relative in ("scripts/post_review.py", "references/post-review.md"):
        assert (ROOT / relative).read_bytes() == (OTHER_ROOT / relative).read_bytes()


@pytest.mark.parametrize("platform", ["linkedin", "x"])
def test_pass_then_edit_invalidates_review(tmp_path, platform):
    path, record, _, _ = reviewed(tmp_path, platform=platform)
    assert review.validate(path, platform)["ok"]
    review.enforce(path, CLEAN, platform)
    path.write_text(CLEAN + "\nAnother claim.")
    assert not review.validate(path, platform)["ok"]
    with pytest.raises(SystemExit, match="Draft changed"):
        review.enforce(path, path.read_text(), platform)


def test_publish_text_must_match_file(tmp_path):
    path, _, _, _ = reviewed(tmp_path)
    assert review.validate(path, text="\n" + CLEAN + "\n")["ok"]
    assert not review.validate(path, text="Other payload")["ok"]


@pytest.mark.parametrize("mutation", [
    lambda r: r.update(version=0),
    lambda r: r.update(platform="other"),
    lambda r: r.update(reviewer="mock"),
    lambda r: r.update(reviewer="skipped"),
    lambda r: r["checks"]["voice"].update(status="fail"),
    lambda r: r["checks"]["naturalness"].update(quote="not in draft"),
    lambda r: r["checks"]["clarity"].update(reason=" "),
    lambda r: r["checks"]["substance"].update(quote=""),
    lambda r: r["context"].update(voice=[]),
    lambda r: r["context"].update(samples="fake"),
    lambda r: r["checks"].pop("ending"),
])
def test_no_partial_or_fake_completion(tmp_path, mutation):
    path, record, _, _ = reviewed(tmp_path)
    mutation(record)
    save(path, record)
    assert not review.validate(path)["ok"]


@pytest.mark.parametrize("target", ["voice", "samples", "sources"])
def test_changed_evidence_invalidates_review(tmp_path, target):
    path, _, voice, samples = reviewed(tmp_path)
    {"voice": voice, "samples": samples, "sources": path.with_suffix(".sources.json")}[target].write_text("changed")
    assert not review.validate(path)["ok"]


@pytest.mark.parametrize("bad", [None, "{", "null", "[]", "42", '"pass"', '{}'])
def test_missing_or_malformed_records_fail_closed(tmp_path, bad):
    path, _, _, _ = reviewed(tmp_path)
    if bad is None:
        review.sidecar(path).unlink()
    else:
        review.sidecar(path).write_text(bad)
    assert not review.validate(path)["ok"]
    assert not review.validate(None)["ok"]


def test_empty_context_and_deleted_context_fail(tmp_path):
    path, _, voice, samples = reviewed(tmp_path)
    voice.write_text("")
    assert not review.validate(path)["ok"]
    samples.unlink()
    assert not review.validate(path)["ok"]


def test_prepare_resets_an_old_pass(tmp_path):
    path, _, voice, samples = reviewed(tmp_path)
    review.prepare(path, [voice], [samples])
    assert not review.validate(path)["ok"]


@pytest.mark.parametrize("key", review.COMPARISONS)
@pytest.mark.parametrize("change", ["missing", "pending", "fail", "no_quote", "wrong_quote",
                                   "no_alternative", "same_alternative", "whitespace_alternative", "no_reason"])
def test_comparisons_are_required_even_when_all_rubric_rows_pass(tmp_path, key, change):
    path, record, _, _ = reviewed(tmp_path)
    comparison = record["comparisons"][key]
    if change == "missing":
        del record["comparisons"][key]
    elif change in {"pending", "fail"}:
        comparison["status"] = change
    elif change == "no_quote":
        comparison["quote"] = ""
    elif change == "wrong_quote":
        comparison["quote"] = "This passage is absent."
    elif change == "no_alternative":
        comparison["alternative"] = " "
    elif change == "same_alternative":
        comparison["alternative"] = comparison["quote"]
    elif change == "whitespace_alternative":
        comparison["alternative"] = "  ".join(comparison["quote"].split())
    else:
        comparison["reason"] = ""
    save(path, record)
    assert not review.validate(path)["ok"]


def test_opening_comparison_uses_opening_and_cannot_only_delete_it(tmp_path):
    path, record, _, _ = reviewed(tmp_path)
    record["comparisons"]["opening"]["quote"] = CLEAN.splitlines()[-1]
    save(path, record)
    assert not review.validate(path)["ok"]
    record["comparisons"]["opening"]["quote"] = CLEAN.splitlines()[0]
    record["comparisons"]["opening"]["alternative"] = "[delete]"
    save(path, record)
    assert not review.validate(path)["ok"]


def test_legacy_pass_cannot_be_shown_without_new_editorial_work(tmp_path, capsys):
    path, record, _, _ = reviewed(tmp_path)
    record["version"] = 1
    del record["comparisons"]
    save(path, record)
    assert review.main(["check", "--file", str(path), "--show"]) == 2
    assert CLEAN not in capsys.readouterr().out


@pytest.mark.parametrize("platform", ["linkedin", "x"])
def test_questions_require_specific_decisions_but_are_not_banned(tmp_path, platform):
    text = 'Which run should be the comparison?\n\nThe report asks "Was a workout planned?"'
    path, record, _, _ = reviewed(tmp_path, text, platform)
    questions = [f for f in record["findings"] if f["rule"] == "question_purpose"]
    assert len(questions) == 2
    assert all(f["severity"] == "WARN" for f in questions)
    assert not review.validate(path, platform)["ok"]
    record["warnings"][questions[0]["id"]] = dict(decision="keep", reason="Synthetic genuine request for a comparison choice.")
    save(path, record)
    assert not review.validate(path, platform)["ok"]  # Every question needs its own decision.
    record["warnings"][questions[1]["id"]] = dict(decision="keep", reason="Synthetic quotation describes the supplied report, not a reader CTA.")
    save(path, record)
    assert review.validate(path, platform)["ok"]


def test_warnings_need_individual_contextual_resolution(tmp_path):
    path, record, _, _ = reviewed(tmp_path, "I was afraid to share the broken demo.")
    assert not review.validate(path)["ok"]
    for item in record["warnings"].values():
        item.update(decision="keep", reason="The user supplied this exact feeling and event; it is necessary context.")
    save(path, record)
    assert review.validate(path)["ok"]


@pytest.mark.parametrize("platform", ["linkedin", "x"])
def test_hard_findings_cannot_be_overruled_by_pass_record(tmp_path, platform):
    path, record, _, _ = reviewed(tmp_path, "I changed it — the write stopped.", platform)
    record["findings"] = []  # Stored findings are not trusted.
    save(path, record)
    assert not review.validate(path, platform)["ok"]


@pytest.mark.parametrize("rule,bad,good", [
    ("engagement_bait", "Comment YES below.", "The code comment explains the timeout."),
    ("stock_hook", "Nobody talks about this.", "We talked about the timeout."),
    ("stock_language", "Our synergy will move the needle.", "The needle moved two marks."),
    ("performative_emotion", "I am humbled by this new chapter.", "I thanked the colleague who found the bug."),
    ("tidy_reframe", "It's not just speed, it's trust.", "The retry did not change the result."),
    ("credential_flex", "After 16 years of experience.", "The file is 16 years old."),
    ("repetition", "I moved the check into the write path. I moved the check into the write path.", CLEAN),
    ("long_sentence", " ".join(["word"] * 36), "I tried again."),
    ("question_purpose", "What should a top rating mean?", "The top rating means the plan was followed."),
])
def test_smells_two_sided(rule, bad, good):
    assert rule in {f["rule"] for f in review.scan(bad, "x")}
    assert rule not in {f["rule"] for f in review.scan(good, "x")}


def test_platform_limits_and_thread_checks():
    assert any(f["rule"] == "empty" for f in review.scan("", "x"))
    assert any(f["rule"] == "linkedin_length" for f in review.scan("x" * 3001, "linkedin"))
    assert not review.scan("x" * 280, "x")
    assert any(f["rule"] == "x_length" for f in review.scan("x" * 281, "x"))
    assert any(f["rule"] == "x_length" for f in review.scan("中" * 141, "x"))
    assert not review.scan("x" * 280 + "\n---\n" + "y" * 280, "x")
    assert any(f["rule"] == "x_hashtags" for f in review.scan("#one #two #three", "x"))
    assert any(f["rule"] == "reflexive_cta" for f in review.scan("Thoughts?\n---\nSecond tweet.", "x"))
    assert any(f["rule"] == "rule_of_three_no" for f in review.scan("No app. No cloud. No code.", "x"))
    hits = review.scan("Game-changer. Game-changer.", "x")
    assert len([f for f in hits if f["rule"] == "stock_language"]) == 1


def test_real_published_corpus_has_no_new_hard_failures():
    corpus = list((ROOT / "evals/baseline/drafts").glob("*.md"))
    assert len(corpus) >= 6
    for path in corpus:
        failures = [f for f in review.scan(path.read_text(), review.PLATFORM) if f["severity"] == "FAIL"]
        assert not failures, (path.name, failures)


def test_cli_withholds_failed_text_and_shows_only_pass(tmp_path, capsys):
    path, record, _, _ = reviewed(tmp_path)
    assert review.main(["check", "--file", str(path), "--show"]) == 0
    assert CLEAN in capsys.readouterr().out
    record["checks"]["hook"]["status"] = "fail"
    save(path, record)
    assert review.main(["check", "--file", str(path), "--show"]) == 2
    assert CLEAN not in capsys.readouterr().out


def test_cli_prepare_and_source_failure(tmp_path, capsys, monkeypatch):
    path, _, voice, samples = reviewed(tmp_path)
    assert review.main(["check", "--file", str(path)]) == 0
    assert CLEAN not in capsys.readouterr().out
    monkeypatch.setattr(review.verify_sources, "verify", lambda p: {"ok": False, "reason": "offline"})
    assert review.main(["check", "--file", str(path), "--show"]) == 2
    assert CLEAN not in capsys.readouterr().out
    assert review.main(["prepare", "--file", str(path), "--voice", str(voice), "--samples", str(samples)]) == 0
    assert not review.validate(path)["ok"]
    assert review.main(["prepare", "--file", str(tmp_path / "missing")]) == 2


def test_concurrent_edit_during_source_check_is_not_shown(tmp_path, capsys, monkeypatch):
    path, _, _, _ = reviewed(tmp_path)

    def changing_source_check(p):
        path.write_text("Unchecked replacement draft")
        return {"ok": True, "reason": "live"}

    monkeypatch.setattr(review.verify_sources, "verify", changing_source_check)
    assert review.main(["check", "--file", str(path), "--show"]) == 2
    output = capsys.readouterr().out
    assert CLEAN not in output and "Unchecked replacement draft" not in output


@pytest.mark.parametrize("state", ["missing", "pending", "stale", "pass"])
@pytest.mark.parametrize("draft_only", [False, True])
def test_publish_gate_before_external_writes(tmp_path, monkeypatch, state, draft_only):
    if review.PLATFORM == "linkedin" and draft_only:
        pytest.skip("LinkedIn has no external draft-only mode")
    path, record, voice, samples = reviewed(tmp_path)
    if state == "missing":
        review.sidecar(path).unlink()
    elif state == "pending":
        review.prepare(path, [voice], [samples])
    elif state == "stale":
        path.write_text(CLEAN + "\nI ran it again.")
    calls = []
    argv = ["post", "--file", str(path)]
    if review.PLATFORM == "linkedin":
        import linkedin_post as publisher
        monkeypatch.setattr(publisher, "load_env", lambda: {"LINKEDIN_PERSON_URN": "person", "LINKEDIN_ACCESS_TOKEN": "test"})
        monkeypatch.setattr(publisher, "warn_if_token_expiring", lambda env: None)
        monkeypatch.setattr(publisher, "warn_publish_conditions", lambda: None)
        monkeypatch.setattr(publisher, "publish", lambda *a: calls.append("publish"))
        monkeypatch.setattr(publisher, "initialize_image_upload", lambda *a: (calls.append("upload"), "image"))
        monkeypatch.setattr(publisher, "upload_file_bytes", lambda *a: None)
    else:
        import typefully_post as publisher
        monkeypatch.setattr(publisher, "load_env", lambda *a: {})
        monkeypatch.setattr(publisher, "require_setup", lambda env: "social")
        monkeypatch.setattr(publisher, "publish_draft", lambda *a, **kw: calls.append("publish") or {"id": 1, "private_url": "url"})
        monkeypatch.setattr(publisher, "upload_media", lambda *a: calls.append("upload") or "image")
        if draft_only:
            argv.append("--draft-only")
    img = tmp_path / "card.png"
    img.write_bytes(b"png")
    argv += ["--image", str(img), "--allow-unverified"]
    monkeypatch.setattr(sys, "argv", argv)
    if state == "pass":
        publisher.main()
        assert calls == ["upload", "publish"]
    else:
        with pytest.raises(SystemExit, match="post review blocked"):
            publisher.main()
        assert calls == []


def test_legacy_bypass_cannot_skip_review(tmp_path, monkeypatch):
    if review.PLATFORM == "linkedin":
        import linkedin_post as publisher
        monkeypatch.setattr(publisher, "load_env", lambda: {"LINKEDIN_PERSON_URN": "person"})
        argv = ["post", "--text", CLEAN, "--allow-unverified", "--allow-ai-tells"]
    else:
        import typefully_post as publisher
        monkeypatch.setattr(publisher, "load_env", lambda *a: {})
        monkeypatch.setattr(publisher, "require_setup", lambda env: "social")
        argv = ["post", "--text", CLEAN, "--allow-unverified", "--draft-only"]
    monkeypatch.setattr(sys, "argv", argv)
    with pytest.raises(SystemExit, match="post review blocked"):
        publisher.main()


@pytest.mark.parametrize("approved", [False, True])
def test_dry_run_also_withholds_unreviewed_copy(tmp_path, monkeypatch, capsys, approved):
    path, _, _, _ = reviewed(tmp_path)
    if not approved:
        review.sidecar(path).unlink()
    if review.PLATFORM == "linkedin":
        import linkedin_post as publisher
        monkeypatch.setattr(publisher, "load_env", lambda: {})
        monkeypatch.setattr(publisher, "warn_publish_conditions", lambda: None)
    else:
        import typefully_post as publisher
        monkeypatch.setattr(publisher, "load_env", lambda *a: {})
    monkeypatch.setattr(sys, "argv", ["post", "--file", str(path), "--dry-run"])
    if approved:
        publisher.main()
        assert "DRY RUN" in capsys.readouterr().out
    else:
        with pytest.raises(SystemExit, match="post review blocked"):
            publisher.main()
        assert not capsys.readouterr().out
