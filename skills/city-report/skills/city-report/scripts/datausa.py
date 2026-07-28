"""Data USA tesseract API client: place resolution, parallel fan-out, disk cache.

Stdlib only — ``urllib`` plus a thread pool. The whole point of this module is
that a city load is one burst of concurrent requests, not a sequence: measured
against the live API, 38 queries complete in 1.17s, so there is no reason for a
user to ever wait on this.

Caching has two tiers, both under ``$TMPDIR/city-report/``:

* the Place member list (~1.5MB, 29,577 places) — 30 days, since Census place
  rosters change once a year at most;
* a city's assembled data bundle — 24 hours, since ACS releases annually.

Both are just JSON on disk. ``--refresh`` bypasses them.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import manifest

API_ROOT = "https://api.datausa.io/tesseract/"

#: Concurrency for the fan-out. High enough that a full load is one round trip
#: in wall-clock terms, low enough to stay a polite client of a free API.
MAX_WORKERS = 12

#: Per-request timeout. The API answers a place query in ~1s; anything past
#: this is a stall, and a stalled metric degrades to "unavailable" rather than
#: hanging the whole report.
TIMEOUT = 30

#: Transient-failure retries. The value-bucket and race cubes intermittently
#: 500 under concurrency; one retry clears essentially all of it.
RETRIES = 2
RETRY_BACKOFF = 0.4

MEMBERS_TTL = 30 * 24 * 3600
BUNDLE_TTL = 24 * 3600

USER_AGENT = "city-report-skill/0.1 (+https://github.com/natejswenson/claude-skills)"


class DataUSAError(RuntimeError):
    """A query failed after retries, or the API returned an error envelope."""


# --------------------------------------------------------------------- cache


def cache_dir() -> str:
    """The on-disk cache root, created on demand.

    Lives under the system temp dir so it is genuinely scratch — losing it
    costs one 2-second refetch, never user data.
    """
    root = os.path.join(tempfile.gettempdir(), "city-report")
    os.makedirs(root, exist_ok=True)
    return root


def cache_path(name: str) -> str:
    return os.path.join(cache_dir(), name)


def read_cache(name: str, ttl: int) -> dict | None:
    """Return cached JSON if present and younger than ``ttl`` seconds.

    A corrupt cache file is treated as a miss, not an error — a half-written
    bundle from an interrupted run must never break the next one.
    """
    path = cache_path(name)
    try:
        if time.time() - os.path.getmtime(path) > ttl:
            return None
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def script_cmd(name: str) -> str:
    """A copy-pasteable command for a sibling script.

    Error messages have to name a path the user can actually run. When the
    skill is installed as a plugin the scripts live under
    ``~/.claude/skills/city-report/`` and the user's shell is somewhere else
    entirely, so a bare ``scripts/load.py`` is a dead end. ``~`` is folded back
    in to keep the hint short.
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
    home = os.path.expanduser("~")
    if path.startswith(home + os.sep):
        path = "~" + path[len(home):]
    return f"python3 {path}"


def list_cached() -> list[tuple[str, str]]:
    """Every city bundle on disk, as ``(slug, display name)``, newest first.

    Exists so no command ever demands a slug the user has no way to recall. A
    slug is an implementation detail of the cache; making someone retype
    ``minneapolis-mn`` from memory to see a report they just loaded is a poor
    trade for the four characters it saves.
    """
    out = []
    for entry in os.scandir(cache_dir()):
        if not (entry.name.startswith("bundle-") and entry.name.endswith(".json")):
            continue
        slug = entry.name[len("bundle-"):-len(".json")]
        try:
            with open(entry.path, "r", encoding="utf-8") as fh:
                name = json.load(fh)["place"]["name"]
        except (OSError, ValueError, KeyError):
            continue
        out.append((slug, name, entry.stat().st_mtime))
    out.sort(key=lambda row: row[2], reverse=True)
    return [(slug, name) for slug, name, _ in out]


def resolve_cached_slug(wanted: str | None) -> tuple[str | None, str]:
    """Turn whatever the caller typed into a cached slug.

    Accepts a slug (``minneapolis-mn``), a place name (``"Minneapolis, MN"``),
    or nothing at all — which resolves to the only loaded city when there is
    exactly one. Returns ``(slug, message)``; ``slug`` is ``None`` when the
    caller needs to be told something, and ``message`` is that text.
    """
    cached = list_cached()
    if not cached:
        return None, ('No city loaded yet. Run:\n'
                      f'  {script_cmd("load.py")} "<City, ST>"')

    if wanted:
        target = wanted.strip()
        lowered = target.lower()
        for slug, name in cached:
            if lowered in (slug.lower(), name.lower()):
                return slug, ""
        # A slugified place name, so `report.py "Minneapolis, MN"` works too.
        slugged = slugify(target)
        for slug, _ in cached:
            if slug == slugged:
                return slug, ""
        listing = "\n".join(f"  {slug:<28} {name}" for slug, name in cached)
        return None, (f'"{target}" is not loaded. Cached cities:\n{listing}\n\n'
                      f'Or load it:  {script_cmd("load.py")} "{target}"')

    if len(cached) == 1:
        return cached[0][0], ""
    listing = "\n".join(f"  {slug:<28} {name}" for slug, name in cached)
    return None, (f"{len(cached)} cities are loaded — name one:\n{listing}")


def write_cache(name: str, payload: dict) -> str:
    """Write ``payload`` atomically, so a killed run can't leave a torn file."""
    path = cache_path(name)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    os.replace(tmp, path)
    return path


# ----------------------------------------------------------------- transport


def _fetch(path: str, params: dict) -> dict:
    """GET ``API_ROOT + path`` with ``params``, parsed as JSON.

    Raises ``DataUSAError`` on transport failure after retries, or when the API
    returns its error envelope (which arrives with HTTP 400/500 and a ``detail``
    string — usually a misspelled level name).
    """
    url = f"{API_ROOT}{path}?{urllib.parse.urlencode(params)}"
    last: Exception | None = None
    for attempt in range(RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if isinstance(payload, dict) and payload.get("error"):
                raise DataUSAError(f"{path}: {payload.get('detail', 'API error')}")
            return payload
        except DataUSAError:
            raise
        except (urllib.error.URLError, OSError, ValueError) as exc:
            last = exc
            if attempt < RETRIES:
                time.sleep(RETRY_BACKOFF * (attempt + 1))
    raise DataUSAError(f"{path} failed after {RETRIES + 1} attempts: {last}")


def _fetch_all(jobs: list[tuple[str, str, dict]]) -> dict[str, dict | None]:
    """Run ``(key, path, params)`` jobs concurrently; return ``{key: payload}``.

    A job that fails maps to ``None`` rather than aborting the batch. One dead
    cube must degrade one section of the report, not the whole city — Data USA
    has already retired two cubes out from under this skill's manifest, so
    partial failure is the expected steady state, not an edge case.
    """
    out: dict[str, dict | None] = {}

    def run(job: tuple[str, str, dict]) -> tuple[str, dict | None]:
        key, path, params = job
        try:
            return key, _fetch(path, params)
        except DataUSAError:
            return key, None

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for key, payload in pool.map(run, jobs):
            out[key] = payload
    return out


# ---------------------------------------------------------- place resolution


@dataclass(frozen=True)
class Place:
    """A resolved geography plus the two benchmark rails it is judged against."""

    name: str          # "Minneapolis, MN"
    place_id: str      # "16000US2743000"
    state_name: str    # "Minnesota"
    state_id: str      # "04000US27"
    slug: str          # "minneapolis-mn"


def slugify(caption: str) -> str:
    """``"Minneapolis, MN"`` -> ``"minneapolis-mn"``; safe as a filename."""
    keep = [c.lower() if c.isalnum() else "-" for c in caption]
    slug = "".join(keep)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")


def _members(cube: str, level: str, ttl: int) -> list[dict]:
    """Cached ``/members`` list for one cube level."""
    name = f"members-{cube}-{level}.json".replace(" ", "_")
    cached = read_cache(name, ttl)
    if cached is None:
        cached = _fetch("members", {"cube": cube, "level": level})
        write_cache(name, cached)
    return [m for m in cached.get("members", []) if m.get("caption")]


def load_places(refresh: bool = False) -> list[dict]:
    """All 29,576 Census places as ``{key, caption}``, cached 30 days."""
    return _members(manifest.PLACE_LOOKUP_CUBE, "Place", 0 if refresh else MEMBERS_TTL)


def load_states(refresh: bool = False) -> list[dict]:
    """All states as ``{key, caption}``, cached 30 days."""
    return _members(manifest.PLACE_LOOKUP_CUBE, "State", 0 if refresh else MEMBERS_TTL)


def state_id_for_place(place_id: str) -> str:
    """Derive the parent State ID from a Place GEOID.

    Census GEOIDs are positional: a place is ``16000US`` + a 2-digit state FIPS
    + a 5-digit place code, and a state is ``04000US`` + that same FIPS. Reading
    the prefix is exact and free, which beats spending a round trip on
    ``parents=true`` just to learn something the ID already encodes.
    """
    fips = place_id.split("US")[-1][:2]
    return f"04000US{fips}"


def resolve_place(query: str, refresh: bool = False) -> tuple[list[Place], str]:
    """Resolve a ``"City, ST"`` string to candidate places.

    Returns ``(candidates, how)``. ``how`` is the strategy that matched, so the
    caller can tell the user when a fuzzy match was involved rather than
    presenting a guess as a lookup.

    Three passes, narrowest first:

    1. exact caption match — captions are unique across all 29,576 places, so an
       exact hit is unambiguous and returns a single candidate;
    2. prefix match within the named state — this is what finds
       ``"Indianapolis city (balance), IN"`` from ``"Indianapolis, IN"``. Eight
       consolidated city-county governments carry captions like that, and exact
       matching alone fails on every one of them;
    3. substring match — last resort for typos and partial names.

    A query with no state suffix (``"Springfield"``) legitimately matches many
    places; the caller is expected to ask rather than pick.
    """
    places = load_places(refresh=refresh)
    state_name_by_id = {s["key"]: s["caption"] for s in load_states(refresh=refresh)}

    def build(member: dict) -> Place:
        pid = member["key"]
        sid = state_id_for_place(pid)
        return Place(
            name=member["caption"],
            place_id=pid,
            state_name=state_name_by_id.get(sid, "United States"),
            state_id=sid,
            slug=slugify(member["caption"]),
        )

    needle = " ".join(query.split()).strip()
    lowered = needle.lower()

    exact = [m for m in places if m["caption"].lower() == lowered]
    if exact:
        return [build(m) for m in exact], "exact"

    # "Indianapolis, IN" -> city "indianapolis", state suffix ", in"
    if "," in needle:
        city, _, state = needle.rpartition(",")
        suffix = f", {state.strip().lower()}"
        city_l = city.strip().lower()
        prefix = [
            m for m in places
            if m["caption"].lower().endswith(suffix)
            and m["caption"].lower().startswith(city_l)
        ]
        if prefix:
            return [build(m) for m in prefix], "prefix"

    loose = [m for m in places if lowered in m["caption"].lower()]
    if loose:
        return [build(m) for m in loose[:25]], "fuzzy"
    return [], "none"


# ------------------------------------------------------------------ fan-out


def _query_params(cube: str, drilldowns: tuple[str, ...], measures: list[str],
                  geo_level: str, geo_id: str) -> dict:
    """Build one tesseract ``data.jsonrecords`` query.

    ``include`` filters to the single geography; the drilldowns come straight
    from the manifest and are never widened here. Requesting the measure and
    its ``Moe`` together is deliberate — a figure and the means to judge it
    should never arrive in separate round trips, or the report will end up
    stating one without the other.
    """
    return {
        "cube": cube,
        "drilldowns": ",".join(drilldowns),
        "measures": ",".join(measures),
        "include": f"{geo_level}:{geo_id}",
    }


def fetch_place_data(place: Place, include_benchmarks: bool = True) -> dict:
    """Fetch every manifest query for ``place`` (+ state and nation) at once.

    One ``ThreadPoolExecutor`` burst covering all three geographies. Returns
    ``{geo_level: {query_key: payload|None}}`` where ``query_key`` is
    ``"<cube>|<drilldowns>|<measure>"``.
    """
    geos = [("Place", place.place_id)]
    if include_benchmarks:
        geos += [("State", place.state_id), ("Nation", "01000US")]

    jobs: list[tuple[str, str, dict]] = []
    for level, geo_id in geos:
        for cube, drilldowns, measure in manifest.unique_queries():
            qkey = f"{level}||{cube}|{','.join(drilldowns)}|{measure}"
            params = _query_params(
                cube, drilldowns,
                [measure, manifest.moe_name(measure)], level, geo_id)
            jobs.append((qkey, "data.jsonrecords", params))

    raw = _fetch_all(jobs)

    out: dict[str, dict] = {}
    for qkey, payload in raw.items():
        level, _, rest = qkey.partition("||")
        out.setdefault(level, {})[rest] = payload
    return out


def query_key(cube: str, drilldowns: tuple[str, ...], measure: str) -> str:
    """The key ``fetch_place_data`` files a query's payload under."""
    return f"{cube}|{','.join(drilldowns)}|{measure}"
