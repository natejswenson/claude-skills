# Common Scripture provider

Bible-API.com is the single implemented Bible-data provider. WEB is the default; no key,
account, or paid service is needed. The registry in `sources.json` owns the base URL and
default translation. Both Claude Code and Codex call the same Node 18+ script.

## Retrieve, read, then cite

```sh
node scripts/bible-data.mjs fetch --reference "John 3" --out /absolute/output/scripture/john-3.json --cache /absolute/output/bible-cache
node scripts/bible-data.mjs fetch --reference "Numbers 21:4-9" --out /absolute/output/scripture/numbers-21.json --cache /absolute/output/bible-cache
node scripts/bible-data.mjs sources
```

Use the same cache directory for all studies when appropriate. For each requested passage:
1. Fetch its book catalog and canonical chapter endpoint (`/data/web/JHN/3`).
2. Read `verses` and `contextVerses`; fetch adjacent chapters if context requires them.
3. Copy the emitted record unchanged into the study bundle's `scripture` array.
4. Add a Bible source with `providerId: bible-api`, the record's `url` and
   `scriptureReference: reference`; mark `read` only after reading it.
5. Use its translation name and license. Verify quotations against the cited verses.

The client accepts full API book names or canonical IDs, one chapter or an in-chapter
verse range. `John 3` gets the whole chapter; `Jude 1` gets Jude's entire chapter, avoiding
the provider's ambiguous free-text endpoint. Fetch a multi-chapter request one chapter at
a time; combine and label the study scope explicitly. Default bundle validation expects
one main passage record, so split multi-chapter studies until aggregate scope is supported.

`--translation kjv` requests a different available translation explicitly. The live book
catalog confirms availability; no fallback to WEB is allowed. This provider does not offer
every translation or canon. Honor a requested translation: if unavailable, explain that a
supported translation must be chosen or a licensed provider separately implemented. Do not
claim API.Bible support; that is a different service requiring its own integration and access.

## Cache and failure behavior

Responses are cached by URL with original retrieval timestamps. Cached Scripture is reused
without network; `--refresh` requests a fresh copy. `--offline` forbids network and fails if
needed data is absent. Cache is persistent, not a promise of recent verification: preserve
its original timestamp and use refresh when freshness matters. Invalid caches fail clearly.
Never claim that cached data was freshly retrieved. Keep personal caches under the user's
output directory, not inside the installed plugin.

Requests are sequential with at least 2.2 seconds between network starts in one client.
The provider currently limits clients to 15 requests per 30 seconds per IP; avoid parallel
processes. A 429 surfaces Retry-After (or at least 30 seconds), with no retry storm. Requests
have a 20-second timeout. Errors never trigger another Bible website or translation.
Do not download an entire Bible through this service.

Checks reject wrong translations/books/chapters, gaps, duplicates, blank verses, invalid
ranges and altered selections. A full chapter endpoint supplies context; the API does not
supply an independent verse-count manifest, so sequence checks alone cannot detect a
missing tail. Review requested boundaries against the passage. Numbering omissions in a
translation require review, not fabricated verses. These checks do not prove textual accuracy.

## Evidence and offline tests

Official API docs: https://bible-api.com/
Source/response examples: https://github.com/seven1m/bible_api
Checked September 19, 2026. Read the current docs before changing the adapter.

`evals/input/api/books-web.json` and `john-3.json` are actual API responses from that date.
API tests replay those fixtures with injected HTTP responses; CI makes no network calls.
After a reviewed upstream change, fetch John 3 with `--refresh`, inspect the saved
chapter and catalog, then run `node scripts/refresh-api-fixtures.mjs --from /absolute/cache`
and `npm test`. The refresh reads those two cached responses without making network calls. John 3 must retain all 36 verses. Adversarial fixtures
are mutations of real data except the explicitly synthetic Jude endpoint-routing test.
