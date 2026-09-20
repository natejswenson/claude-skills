#!/usr/bin/env python3
"""Review Codex imagegen assets before presentation or attachment.

Canonical copy: ghostwriter/scripts/visual_review.py; bundle identically in X.
Records attest to visual judgment, not an automated aesthetic score or approval.
Native screenshots and legacy renders retain their existing review workflow.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import struct

import post_review

GENERATOR = "codex-imagegen"
RUBRIC = (
    "post_alignment", "visual_substance", "brand_fidelity", "composition",
    "hierarchy", "typography", "text_fidelity", "credibility", "artifacts",
    "originality", "feed_readability", "accessibility",
)


def manifest(path):
    return Path(path).with_suffix(".visuals.json")


def sidecar(image):
    return Path(image).with_suffix(".visual-review.json")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, record):
    Path(path).write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def inventory(path):
    record = read_json(manifest(path))
    if record["version"] != 1 or not isinstance(record["images"], dict) or not record["images"]:
        raise ValueError("Malformed visual inventory")
    for name, origin in record["images"].items():
        if not Path(name).is_absolute() or origin not in (GENERATOR, "native", "legacy"):
            raise ValueError("Invalid visual origin")
    return record


def register(path, image, origin=GENERATOR):
    """Declare origin before generation; an existing generated asset cannot downgrade."""
    p = manifest(path)
    record = inventory(path) if p.exists() else {"version": 1, "images": {}}
    name = str(Path(image).resolve())
    if origin not in (GENERATOR, "native", "legacy"):
        raise ValueError("Invalid visual origin")
    if name in record["images"] and record["images"][name] != origin:
        raise ValueError("An asset's declared origin cannot change; use a new asset path")
    record["images"][name] = origin
    write_json(p, record)


def png_size(image):
    """Check PNG header and intended export size; actual decoding is the visual review."""
    header = Path(image).read_bytes()[:24]
    if Path(image).suffix.lower() != ".png" or header[:16] != b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR":
        raise ValueError("Generated card must be a PNG")
    width, height = struct.unpack(">II", header[16:24])
    if width < 1024 or height < 1280 or abs(width / height - 0.8) > 0.008:
        raise ValueError("Generated card must be portrait 4:5 (1% tolerance), at least 1024 by 1280")
    return [width, height]


def prepare(path, image, receipt, brand, evidence):
    p = Path(path).resolve()
    record = {
        "version": 1, "generator": GENERATOR, "platform": post_review.PLATFORM,
        "image": post_review.snapshot(image), "dimensions": png_size(image),
        "context": {
            "draft": [post_review.snapshot(p)],
            "text_review": [post_review.snapshot(post_review.sidecar(p))],
            "sources": [post_review.snapshot(p.with_suffix(".sources.json"))],
            "receipt": [post_review.snapshot(receipt)],
            "brand": [post_review.snapshot(b) for b in brand],
            "evidence": [post_review.snapshot(e) for e in evidence],
        },
        "reviewer": "pending",
        "inspection": {"full_resolution": "", "feed_360px": ""},
        "observed_text": [],
        "checks": {key: {"status": "pending", "region": "", "reason": ""} for key in RUBRIC},
    }
    register(path, image)
    write_json(sidecar(image), record)
    return record


def validate(path, image, alt=None, tweet_index=None):
    errors = []
    try:
        p, img = Path(path).resolve(), Path(image).resolve()
        record = read_json(sidecar(img))
        if (record["version"] != 1 or record["generator"] != GENERATOR
                or record["platform"] != post_review.PLATFORM):
            errors.append("Visual review version, origin or platform mismatch")
        if record["image"] != post_review.snapshot(img) or record["dimensions"] != png_size(img):
            errors.append("Image changed; inspect the entire new image again")
        context = record["context"]
        expected = {"draft": p, "text_review": post_review.sidecar(p),
                    "sources": p.with_suffix(".sources.json")}
        for role in (*expected, "receipt", "brand", "evidence"):
            entries = context[role]
            if not isinstance(entries, list) or not entries:
                errors.append(f"Missing visual {role} evidence")
                continue
            if role in expected and entries != [post_review.snapshot(expected[role])]:
                errors.append(f"Changed visual {role} evidence")
            for entry in entries:
                if (entry != post_review.snapshot(entry["path"])
                        or not Path(entry["path"]).read_bytes().strip()):
                    errors.append(f"Changed or empty visual {role} evidence")
        receipt = read_json(context["receipt"][0]["path"])
        if (receipt["generator"] != GENERATOR or not post_review.nonempty(receipt["post_anchor"])
                or receipt["post_anchor"] not in p.read_text(encoding="utf-8")
                or not post_review.nonempty(receipt["visual_claim"])
                or not post_review.nonempty(receipt["alt_text"])
                or not post_review.nonempty(receipt["prompt"])):
            errors.append("Prompt receipt lacks the post anchor, visual claim, prompt or alt text")
        if alt is not None and alt != receipt["alt_text"]:
            errors.append("Alt text differs from the reviewed image description")
        if post_review.PLATFORM == "x":
            import x_len
            tweets = x_len.split_thread(p.read_text(encoding="utf-8"))
            index = receipt.get("tweet_index")
            if type(index) is not int or not 1 <= index <= len(tweets):
                errors.append("Receipt needs a valid tweet_index")
            elif (receipt["post_anchor"] not in tweets[index - 1]
                  or (tweet_index is not None and tweet_index != index)):
                errors.append("Image must accompany the tweet whose anchor was reviewed")
        intended, observed = receipt["exact_text"], record["observed_text"]
        for strings in (intended, observed):
            if not isinstance(strings, list) or not strings or not all(post_review.nonempty(s) for s in strings):
                raise ValueError("Missing complete rendered-text transcription")
        normalize = lambda strings: Counter(" ".join(s.split()) for s in strings)
        if normalize(intended) != normalize(observed):
            errors.append("Rendered text differs from exact copy (including duplicates or omissions)")
        if record["reviewer"] not in ("independent-visual-editor", "session-visual-editor"):
            errors.append("Visual inspection missing; skipped and mock reviews cannot pass")
        for view in ("full_resolution", "feed_360px"):
            if not post_review.nonempty(record["inspection"][view]):
                errors.append(f"Missing actual visual inspection: {view}")
        for key in RUBRIC:
            check = record["checks"][key]
            if (check["status"] != "pass" or not post_review.nonempty(check["region"])
                    or not post_review.nonempty(check["reason"])):
                errors.append(f"Visual check unresolved: {key}")
        if not post_review.validate(p)["ok"]:
            errors.append("The associated post must have a current passing text review")
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError, IndexError, struct.error):
        errors.append("Visual review or evidence missing/malformed; prepare and inspect again")
    return {"ok": not errors, "errors": errors}


def generated_marker(image):
    """Recognize retained sidecars, including receipts from before the review gate."""
    p = Path(image)
    base = p.with_name(re.sub(r"-generated-v\d+$", "", p.stem) + p.suffix)
    return (sidecar(p).exists() or p.with_suffix(".image.json").exists()
            or base.with_suffix(".image.json").exists())


def enforce(path, attachments):
    """Run before dry-run disclosure and again after source checks, before uploads.

    Attachments are (path, exact alt text[, tweet index]) tuples. No inventory/marker means an
    existing native/legacy attachment. Origin cannot be inferred from pixels.
    """
    if not attachments:
        return
    try:
        entries = inventory(path)["images"] if path is not None and manifest(path).exists() else None
        for image, alt, *position in attachments:
            name = str(Path(image).resolve())
            if entries is not None and name not in entries:
                raise ValueError("Attachment missing from visual inventory; declare its actual origin")
            if (entries is not None and entries[name] == GENERATOR) or generated_marker(image):
                result = validate(path, image, alt or "", position[0] if position else None)
                if not result["ok"]:
                    raise ValueError("; ".join(result["errors"]))
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise SystemExit("ERROR: visual review blocked: " + str(exc)) from exc


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("command", choices=("register", "prepare", "check"))
    ap.add_argument("--file", required=True)
    ap.add_argument("--image", required=True)
    ap.add_argument("--origin", choices=(GENERATOR, "native", "legacy"), default=GENERATOR)
    ap.add_argument("--receipt")
    ap.add_argument("--brand", action="append", default=[])
    ap.add_argument("--evidence", action="append", default=[])
    args = ap.parse_args(argv)
    try:
        if args.command == "register":
            register(args.file, args.image, args.origin)
            print("Visual origin registered; this is not a review or approval")
        elif args.command == "prepare":
            prepare(args.file, args.image, args.receipt, args.brand, args.evidence)
            print("Visual review pending; inspect the image and complete every check")
        else:
            result = validate(args.file, args.image)
            if result["ok"]:
                sources = post_review.verify_sources.verify(args.file)
                if not sources["ok"]:
                    raise ValueError("Source check failed: " + sources["reason"])
                # Slow source checks can race a replacement asset or post.
                result = validate(args.file, args.image)
            if not result["ok"]:
                raise ValueError("; ".join(result["errors"]))
            print("Visual review passed; the exact image may be presented for approval")
        return 0
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, AttributeError, struct.error) as exc:
        print("Visual review blocked: " + str(exc))
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
