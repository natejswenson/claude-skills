"""API-client tests. Every network call is stubbed — this suite never goes out."""
from __future__ import annotations

import json
import time
import urllib.error

import pytest

import datausa

PLACES = [
    {"key": "", "caption": ""},
    {"key": "16000US2743000", "caption": "Minneapolis, MN"},
    {"key": "16000US2047075", "caption": "Minneapolis, KS"},
    {"key": "16000US1836003", "caption": "Indianapolis city (balance), IN"},
    {"key": "16000US2726378", "caption": "Hackensack, MN"},
]
STATES = [
    {"key": "04000US27", "caption": "Minnesota"},
    {"key": "04000US20", "caption": "Kansas"},
    {"key": "04000US18", "caption": "Indiana"},
]


@pytest.fixture
def stub_members(monkeypatch):
    def fake(cube, level, ttl):
        return PLACES[1:] if level == "Place" else STATES
    monkeypatch.setattr(datausa, "_members", fake)


# ------------------------------------------------------------------- caching


def test_cache_roundtrip(tmp_cache):
    datausa.write_cache("x.json", {"a": 1})
    assert datausa.read_cache("x.json", 1000) == {"a": 1}


def test_cache_miss_on_absent_expired_and_corrupt(tmp_cache):
    assert datausa.read_cache("nope.json", 1000) is None

    datausa.write_cache("old.json", {"a": 1})
    import os
    path = datausa.cache_path("old.json")
    os.utime(path, (0, 0))
    assert datausa.read_cache("old.json", 10) is None

    with open(datausa.cache_path("bad.json"), "w", encoding="utf-8") as fh:
        fh.write("{not json")
    assert datausa.read_cache("bad.json", 1000) is None


def test_cache_dir_is_created(monkeypatch, tmp_path):
    monkeypatch.setattr(datausa.tempfile, "gettempdir", lambda: str(tmp_path))
    assert datausa.cache_dir().startswith(str(tmp_path))


# ----------------------------------------------------------------- transport


class FakeResponse:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode()

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_fetch_returns_parsed_json(monkeypatch):
    monkeypatch.setattr(datausa.urllib.request, "urlopen",
                        lambda *a, **k: FakeResponse({"data": [1]}))
    assert datausa._fetch("data.jsonrecords", {"cube": "c"}) == {"data": [1]}


def test_fetch_raises_on_api_error_envelope_without_retrying(monkeypatch):
    calls = []

    def urlopen(*a, **k):
        calls.append(1)
        return FakeResponse({"error": True, "detail": "bad level"})

    monkeypatch.setattr(datausa.urllib.request, "urlopen", urlopen)
    with pytest.raises(datausa.DataUSAError, match="bad level"):
        datausa._fetch("data.jsonrecords", {})
    assert len(calls) == 1  # a malformed query is not worth retrying


def test_fetch_retries_transient_failures_then_gives_up(monkeypatch):
    calls = []

    def urlopen(*a, **k):
        calls.append(1)
        raise urllib.error.URLError("boom")

    monkeypatch.setattr(datausa.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(datausa.time, "sleep", lambda s: None)
    with pytest.raises(datausa.DataUSAError):
        datausa._fetch("data.jsonrecords", {})
    assert len(calls) == datausa.RETRIES + 1


def test_fetch_recovers_on_a_later_attempt(monkeypatch):
    state = {"n": 0}

    def urlopen(*a, **k):
        state["n"] += 1
        if state["n"] == 1:
            raise urllib.error.URLError("transient")
        return FakeResponse({"ok": True})

    monkeypatch.setattr(datausa.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(datausa.time, "sleep", lambda s: None)
    assert datausa._fetch("data.jsonrecords", {}) == {"ok": True}


def test_fetch_all_maps_failures_to_none_without_aborting_the_batch(monkeypatch):
    def fetch(path, params):
        if params["cube"] == "dead":
            raise datausa.DataUSAError("gone")
        return {"data": [params["cube"]]}

    monkeypatch.setattr(datausa, "_fetch", fetch)
    out = datausa._fetch_all([
        ("good", "data.jsonrecords", {"cube": "alive"}),
        ("bad", "data.jsonrecords", {"cube": "dead"}),
    ])
    assert out["bad"] is None
    assert out["good"] == {"data": ["alive"]}


# ---------------------------------------------------------------- resolution


def test_slugify():
    assert datausa.slugify("Minneapolis, MN") == "minneapolis-mn"
    assert datausa.slugify("Louisville/Jefferson County metro (balance), KY").startswith(
        "louisville-jefferson")


def test_state_id_derived_from_place_geoid():
    assert datausa.state_id_for_place("16000US2743000") == "04000US27"
    assert datausa.state_id_for_place("16000US1836003") == "04000US18"


def test_resolve_exact_match_is_unique(stub_members):
    found, how = datausa.resolve_place("Minneapolis, MN")
    assert how == "exact"
    assert len(found) == 1
    assert found[0].place_id == "16000US2743000"
    assert found[0].state_name == "Minnesota"


def test_resolve_is_case_and_whitespace_insensitive(stub_members):
    found, how = datausa.resolve_place("  minneapolis,   MN ")
    assert how == "exact" and len(found) == 1


def test_resolve_prefix_finds_consolidated_city_county_names(stub_members):
    """"Indianapolis, IN" is really "Indianapolis city (balance), IN"."""
    found, how = datausa.resolve_place("Indianapolis, IN")
    assert how == "prefix"
    assert found[0].name == "Indianapolis city (balance), IN"


def test_resolve_ambiguous_returns_every_candidate(stub_members):
    found, how = datausa.resolve_place("Minneapolis")
    assert how == "fuzzy"
    assert {p.name for p in found} == {"Minneapolis, MN", "Minneapolis, KS"}


def test_resolve_no_match(stub_members):
    assert datausa.resolve_place("Nowheresville, ZZ") == ([], "none")


def test_resolve_unknown_state_falls_back_to_nation(monkeypatch):
    monkeypatch.setattr(datausa, "_members",
                        lambda c, l, t: PLACES[1:] if l == "Place" else [])
    found, _ = datausa.resolve_place("Minneapolis, MN")
    assert found[0].state_name == "United States"


def test_members_uses_cache_then_network(tmp_cache, monkeypatch):
    calls = []

    def fetch(path, params):
        calls.append(params)
        return {"members": [{"key": "k", "caption": "Cap"}, {"key": "", "caption": ""}]}

    monkeypatch.setattr(datausa, "_fetch", fetch)
    first = datausa._members("cube", "Place", 1000)
    second = datausa._members("cube", "Place", 1000)
    assert first == second == [{"key": "k", "caption": "Cap"}]
    assert len(calls) == 1  # second call served from disk


def test_load_places_and_states_refresh_bypasses_cache(monkeypatch):
    seen = []
    monkeypatch.setattr(datausa, "_members",
                        lambda c, l, ttl: seen.append(ttl) or [])
    datausa.load_places(refresh=True)
    datausa.load_states(refresh=False)
    assert seen == [0, datausa.MEMBERS_TTL]


# ------------------------------------------------------------------- fan-out


def test_query_params_include_pins_one_geography():
    params = datausa._query_params(
        "cube", ("Year", "Race"), ["M", "M Moe"], "Place", "16000US1")
    assert params["drilldowns"] == "Year,Race"
    assert params["include"] == "Place:16000US1"
    assert params["measures"] == "M,M Moe"


def test_fetch_place_data_covers_all_three_geographies(place, monkeypatch):
    import manifest
    captured = []

    def fetch_all(jobs):
        captured.extend(jobs)
        return {key: {"data": []} for key, _, _ in jobs}

    monkeypatch.setattr(datausa, "_fetch_all", fetch_all)
    out = datausa.fetch_place_data(place)
    assert set(out) == {"Place", "State", "Nation"}
    assert len(captured) == len(manifest.unique_queries()) * 3
    # Each metric's MOE measure must ride along with its estimate.
    for _, _, params in captured:
        measure, moe = params["measures"].split(",", 1)
        assert moe == manifest.moe_name(measure)


def test_fetch_place_data_can_skip_benchmarks(place, monkeypatch):
    monkeypatch.setattr(datausa, "_fetch_all",
                        lambda jobs: {k: None for k, _, _ in jobs})
    out = datausa.fetch_place_data(place, include_benchmarks=False)
    assert set(out) == {"Place"}


def test_query_key_matches_the_bundle_lookup_key():
    assert datausa.query_key("c", ("Year", "Race"), "M") == "c|Year,Race|M"
