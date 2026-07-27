"""Tests for scripts/x_len.py — weighted counting, thread split, CLI."""
from __future__ import annotations

import pytest

import x_len


# ------------------------------------------------------------- weighted_length
@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("hello", 5),  # plain ASCII: weight 1 each
        ("héllo", 5),  # Latin-1 accents are in the light range
        ("日本語", 6),  # CJK: weight 2 each
        ("🔥", 2),  # single emoji: weight 2
        ("†", 2),  # symbol outside the light ranges
        ("ჿ", 1),  # last code point of the first light range
        ("ᄀ", 2),  # first code point past it
        ("‍", 1),  # ZWJ itself is in the U+2000–200D light range
        ("‎", 2),  # LRM just past it
        ("‐", 1),  # hyphen range start
        ("‷", 1),  # prime range end
    ],
)
def test_codepoint_weights(text, expected):
    assert x_len.weighted_length(text) == expected


def test_zwj_sequence_overcounts_conservatively():
    # 👩‍💻 = 👩 (2) + ZWJ (1) + 💻 (2) = 5 here; twitter-text says 2.
    # Over-counting is the documented, safe direction.
    assert x_len.weighted_length("👩‍💻") == 5


def test_nfc_normalization_applied():
    # e + combining acute composes to é (one light code point).
    assert x_len.weighted_length("é") == 1


def test_schemed_url_counts_23():
    url = "https://example.com/a/very/long/path?with=query&and=more"
    assert x_len.weighted_length(url) == 23
    assert x_len.weighted_length(f"look: {url} !") == 23 + len("look:  !")


def test_www_url_counts_23():
    assert x_len.weighted_length("www.example.com/some/long/path/here/ok") == 23


def test_short_bare_domain_charged_full_23():
    # X linkifies example.com, so 23 is the true cost even though len is 11.
    assert x_len.weighted_length("example.com") == 23


def test_long_bare_domain_charged_its_text_weight():
    bare = "example.com/" + "x" * 40  # 52 chars > 23 → max() keeps 52
    assert x_len.weighted_length(bare) == 52


def test_bare_domain_inside_schemed_url_not_double_charged():
    assert x_len.weighted_length("https://foo.example.com/bar") == 23


def test_two_urls_each_count_23():
    text = "https://a.io/x and https://b.io/y"
    assert x_len.weighted_length(text) == 23 + len(" and ") + 23


def test_overlapping_bare_matches_charged_once():
    # Two bare-domain regex hits over the same span must not double-charge.
    text = "go.example.com/path"
    assert x_len.weighted_length(text) == max(23, len(text))


def test_schemed_url_swallowed_by_bare_domain_span():
    # The bare-domain match covers the whole run, including the embedded
    # schemed URL — the schemed span must be skipped, not double-charged.
    text = "foo.com/redirect?u=https://bar.io/page"
    assert x_len.weighted_length(text) == max(23, len(text))


# ------------------------------------------------------------------------ check
def test_check_at_limit():
    ok, n = x_len.check("a" * 280)
    assert ok and n == 280


def test_check_over_limit():
    ok, n = x_len.check("a" * 281)
    assert not ok and n == 281


# ----------------------------------------------------------------- split_thread
def test_split_thread_basic():
    assert x_len.split_thread("one\n---\ntwo\n---\nthree") == ["one", "two", "three"]


def test_split_thread_no_separator():
    assert x_len.split_thread("just one tweet") == ["just one tweet"]


def test_split_thread_drops_empty_segments():
    assert x_len.split_thread("one\n---\n\n---\ntwo\n---\n") == ["one", "two"]


def test_split_thread_separator_needs_own_line():
    text = "a --- b"
    assert x_len.split_thread(text) == [text]


# -------------------------------------------------------------------------- CLI
def run_main(monkeypatch, argv):
    monkeypatch.setattr(x_len.sys, "argv", ["x_len.py", *argv])
    x_len.main()


def test_main_text_ok(monkeypatch, capsys):
    run_main(monkeypatch, ["--text", "hello"])
    assert "[1/1 · 5/280]" in capsys.readouterr().out


def test_main_file_thread_ok(monkeypatch, tmp_path, capsys):
    draft = tmp_path / "d.md"
    draft.write_text("one\n---\ntwo", encoding="utf-8")
    run_main(monkeypatch, ["--file", str(draft), "--thread"])
    out = capsys.readouterr().out
    assert "[1/2 · 3/280]" in out
    assert "[2/2 · 3/280]" in out


def test_main_overflow_exits(monkeypatch, capsys):
    with pytest.raises(SystemExit) as e:
        run_main(monkeypatch, ["--text", "a" * 300])
    assert "280" in str(e.value)
    assert "OVER by 20" in capsys.readouterr().out


def test_main_stdin(monkeypatch, capsys):
    class FakeStdin:
        def isatty(self):
            return False

        def read(self):
            return "from stdin"

    monkeypatch.setattr(x_len.sys, "stdin", FakeStdin())
    run_main(monkeypatch, [])
    assert "10/280" in capsys.readouterr().out


def test_main_tty_no_input_exits(monkeypatch):
    class FakeTty:
        def isatty(self):
            return True

    monkeypatch.setattr(x_len.sys, "stdin", FakeTty())
    with pytest.raises(SystemExit) as e:
        run_main(monkeypatch, [])
    assert "provide --text" in str(e.value)


def test_main_empty_input_exits(monkeypatch):
    with pytest.raises(SystemExit) as e:
        run_main(monkeypatch, ["--text", "   "])
    assert "empty" in str(e.value)
