#!/usr/bin/env python3
"""Fail-closed editorial review, bound to draft, sources and voice evidence.

Canonical copy: ghostwriter/scripts/post_review.py. Bundle the identical file
in ghostwriter-x; tests check parity. No model calls, scores or publisher access.
The record is an editor's attestation, not proof of authorship or human approval.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import verify_sources

PLATFORM = "x" if Path(__file__).resolve().parent.parent.name == "ghostwriter-x" else "linkedin"
RUBRIC = (
    "voice", "naturalness", "substance", "clarity", "hook", "ending",
    "credibility", "restraint", "originality", "platform_fit",
)
VERSION = 2
COMPARISONS = ("opening", "compression")
# Smells need contextual editorial decisions, not automatic claims of AI origin.
SMELLS = {
    "engagement_bait": r"\b(?:comment\s+[\"'\w]+\s+(?:below|and|to)|(?:follow|repost|share)\s+(?:me|this|for)|agree\?|thoughts\?)",
    "stock_hook": r"\b(?:here['’]s the thing|let that sink in|nobody (?:talks|is talking) about|read that again|the (?:harsh|brutal|uncomfortable) truth)\b",
    "stock_language": r"\b(?:delv(?:e|ing)|game[ -]chang(?:er|ing)|seamless(?:ly)?|unlock(?:ing)? (?:your|the) potential|ever[ -]evolving|paradigm shift|synerg(?:y|ies)|thought leadership|move the needle|at the end of the day)\b",
    "performative_emotion": r"\b(?:humbled|thrilled to announce|excited to announce|honored to|new chapter|everyone who believed in me|afraid to share|wasn['’]t going to (?:share|post))\b",
    "tidy_reframe": r"\b(?:it['’]s|it is|this is) not (?:just )?[^.!?\n]{1,70}[,.]\s*(?:it['’]s|it is|this is)\b",
    "credential_flex": r"\b\d+\+? years of experience\b",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sidecar(path):
    return Path(path).with_suffix(".review.json")


def scan(text, platform):
    """Return stable finding IDs. Warnings must each be resolved by the editor."""
    findings = []

    def add(rule, severity, excerpt):
        key = f"{rule}:{digest(excerpt.encode())[:16]}"
        if not any(f["id"] == key for f in findings):
            findings.append(dict(id=key, rule=rule, severity=severity, excerpt=excerpt))

    if not text.strip():
        add("empty", "FAIL", "")
    if platform == "linkedin":
        import ai_tells
        for f in ai_tells.check(text):
            add(f.rule, f.severity, f.excerpt)
        if len(text.strip()) > 3000:
            add("linkedin_length", "FAIL", "Post exceeds 3000 characters")
    else:
        import x_len
        for tweet in x_len.split_thread(text):
            if x_len.weighted_length(tweet) > x_len.LIMIT:
                add("x_length", "FAIL", tweet)
            for rule, pattern in (
                ("em_dash", "—"),
                ("rule_of_three_no", r"\bNo\s+[^.\n]+\.\s+No\s+[^.\n]+\.\s+No\s+[^.\n]+\."),
                ("reflexive_cta", r"(?:thoughts\?|what['’]?s your[^?\n]{0,80}\?|how do you[^?\n]{0,80}\?)\s*👇?\s*$"),
            ):
                for m in re.finditer(pattern, tweet, re.I):
                    add(rule, "FAIL", m.group())
            if len(re.findall(r"(?<![\w&])#[A-Za-z]\w*", tweet)) > 2:
                add("x_hashtags", "FAIL", tweet)
    for rule, pattern in SMELLS.items():
        for m in re.finditer(pattern, text, re.I):
            add(rule, "WARN", m.group())
    # Questions can be useful, quoted, or merely a device for soliciting replies.
    # Require a contextual decision even when no stock CTA pattern matches.
    for m in re.finditer(r"[^.!?\n]*\?", text):
        add("question_purpose", "WARN", m.group().strip())
    sentences = re.split(r"(?<=[.!?])\s+|\n\s*\n", text)
    seen = set()
    for sentence in sentences:
        key = " ".join(sentence.lower().split())
        if len(key.split()) >= 5 and key in seen:
            add("repetition", "WARN", sentence)
        seen.add(key)
        if len(sentence.split()) > 35:
            add("long_sentence", "WARN", sentence)
    return findings


def snapshot(path):
    p = Path(path).resolve()
    return {"path": str(p), "sha256": digest(p.read_bytes())}


def prepare(path, voice, samples, platform=PLATFORM):
    p = Path(path)
    raw = p.read_bytes()
    findings = scan(raw.decode("utf-8"), platform)
    report = {
        "version": VERSION, "platform": platform,
        "draft_sha256": digest(raw),
        "sources_sha256": digest(p.with_suffix(".sources.json").read_bytes()),
        "context": {"voice": [snapshot(v) for v in voice],
                    "samples": [snapshot(s) for s in samples]},
        "reviewer": "pending",
        "checks": {key: {"status": "pending", "quote": "", "reason": ""} for key in RUBRIC},
        "comparisons": {key: {"status": "pending", "quote": "", "alternative": "", "reason": ""}
                        for key in COMPARISONS},
        "warnings": {f["id"]: {"decision": "pending", "reason": ""}
                     for f in findings if f["severity"] == "WARN"},
        "findings": findings,
    }
    sidecar(p).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def validate(path, platform=PLATFORM, text=None):
    """Recompute rather than trust a saved overall PASS. Never print failed copy."""
    errors = []
    try:
        p = Path(path)
        raw = p.read_bytes()
        draft = raw.decode("utf-8")
        report = json.loads(sidecar(p).read_text(encoding="utf-8"))
        if report["version"] != VERSION or report["platform"] != platform:
            errors.append("Review version or platform mismatch")
        if report["draft_sha256"] != digest(raw) or (text is not None and text.strip() != draft.strip()):
            errors.append("Draft changed; review the exact current text again")
        if report["sources_sha256"] != digest(p.with_suffix(".sources.json").read_bytes()):
            errors.append("Source evidence changed; review again")
        for role in ("voice", "samples"):
            entries = report["context"][role]
            if not isinstance(entries, list) or not entries:
                errors.append(f"Missing {role} evidence")
                continue
            for entry in entries:
                content = Path(entry["path"]).read_bytes()
                if not content.strip() or digest(content) != entry["sha256"]:
                    errors.append(f"Changed or empty {role} evidence")
        if report["reviewer"] not in ("session-editor", "independent-editor"):
            errors.append("Editorial review missing; skipped and mock reviews cannot pass")
        for key in RUBRIC:
            check = report["checks"][key]
            if (check["status"] != "pass" or not nonempty(check["reason"])
                    or not nonempty(check["quote"]) or check["quote"] not in draft):
                errors.append(f"Editorial check unresolved: {key}")
        for key in COMPARISONS:
            comparison = report["comparisons"][key]
            quote, alternative = comparison["quote"], comparison["alternative"]
            if (comparison["status"] != "pass" or not nonempty(comparison["reason"])
                    or not nonempty(quote) or quote not in draft
                    or not nonempty(alternative) or " ".join(alternative.split()) == " ".join(quote.split())
                    or (key == "opening" and (not draft.lstrip().startswith(quote)
                                               or alternative.strip() == "[delete]"))):
                errors.append(f"Editorial comparison unresolved: {key}")
        for finding in scan(draft, platform):
            if finding["severity"] == "FAIL":
                errors.append(f"Hard check failed: {finding['rule']}")
            else:
                resolution = report["warnings"].get(finding["id"], {})
                if resolution.get("decision") != "keep" or not nonempty(resolution.get("reason")):
                    errors.append(f"Warning needs a contextual decision: {finding['rule']}")
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError):
        errors.append("Review or evidence missing/malformed; prepare and complete the review")
    return {"ok": not errors, "errors": errors, "draft": draft if not errors else None}


def enforce(path, text, platform=PLATFORM):
    result = validate(path, platform, text)
    if not result["ok"]:
        raise SystemExit("ERROR: post review blocked: " + "; ".join(result["errors"]))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("command", choices=("prepare", "check"))
    ap.add_argument("--file", required=True)
    ap.add_argument("--voice", action="append", default=[])
    ap.add_argument("--samples", action="append", default=[])
    ap.add_argument("--show", action="store_true", help="Print the full draft only after all checks pass")
    args = ap.parse_args(argv)
    if args.command == "prepare":
        try:
            prepare(args.file, args.voice, args.samples)
        except (OSError, UnicodeError, ValueError) as exc:
            print(f"Review blocked: {exc}")
            return 2
        print("Review pending: complete the editorial rubric in " + str(sidecar(args.file)))
        return 0
    result = validate(args.file)
    if result["ok"]:
        candidate = result["draft"]
        sources = verify_sources.verify(args.file)
        if not sources["ok"]:
            result = {"ok": False, "errors": ["Source check failed: " + sources["reason"]]}
        else:
            # Source checks can take seconds. Never print a concurrent edit
            # under the review that passed before that network work began.
            result = validate(args.file, text=candidate)
    if not result["ok"]:
        print("Review blocked: " + "; ".join(result["errors"]))
        return 2
    print("Review passed: editorial checks, resolved warnings, sources and platform limits")
    if args.show:
        print(candidate)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
