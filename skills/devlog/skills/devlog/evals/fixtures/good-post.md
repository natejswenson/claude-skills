---
title: "Retries that don't stampede: exponential backoff with jitter in 40 lines"
date: 2026-07-10
project: fixture
version: v1.3.0
tags: [reliability, python, distributed-systems]
summary: "This release moved our flaky HTTP calls behind a retry wrapper. Here's how to build one with full jitter, and the two traps that bit me."
---

## Shipped

v1.3.0 wraps every outbound HTTP call in a retry decorator with exponential backoff and
full jitter. The change itself is small; the interesting part is why naive retries make
outages worse, and how little code the correct version takes. This post walks the whole
build.

## Prerequisites

You need Python 3.10+ and `httpx`. No other dependencies — the retry logic is stdlib.

```bash
pip install httpx==0.27.0
```

## Build the backoff schedule

Start with the delay calculation, isolated so you can unit-test it. Full jitter means:
sleep a uniform random amount between 0 and the exponential ceiling, which spreads
retrying clients across the whole window instead of synchronizing them into waves —
synchronized retries are exactly how a blip amplifies into an outage
([Google SRE Book: Handling Overload](https://sre.google/sre-book/handling-overload/)).

```python
import random

def backoff_delay(attempt: int, base: float = 0.5, cap: float = 30.0) -> float:
    """Full-jitter delay for a zero-indexed attempt number."""
    ceiling = min(cap, base * (2 ** attempt))
    return random.uniform(0, ceiling)
```

## Wrap it into a retry decorator

The decorator retries only on retryable failures (connection errors — httpx's
[`TransportError` hierarchy](https://www.python-httpx.org/exceptions/) — and 5xx), never
on 4xx: a 404 will be a 404 no matter how many times you ask.

```python
import functools
import time
import httpx

RETRYABLE_STATUS = {500, 502, 503, 504}

def with_retries(max_attempts: int = 5):
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    response = fn(*args, **kwargs)
                    if response.status_code not in RETRYABLE_STATUS:
                        return response
                except httpx.TransportError:
                    if attempt == max_attempts - 1:
                        raise
                time.sleep(backoff_delay(attempt))
            return response
        return wrapper
    return decorator
```

## Use it

Apply it to any function that returns an `httpx.Response`:

```python
@with_retries(max_attempts=5)
def fetch_profile(user_id: str) -> httpx.Response:
    return httpx.get(f"https://api.example.com/users/{user_id}", timeout=5.0)

profile = fetch_profile("u_123")
print(profile.status_code)  # 200 after up to 5 attempts
```

## Verify it

Prove the schedule spreads load before you trust it. Run this against your copy of
`backoff_delay` — every delay must fall inside its window and the cap must hold:

```python
for attempt in range(10):
    d = backoff_delay(attempt)
    assert 0 <= d <= min(30.0, 0.5 * 2 ** attempt), (attempt, d)
print("schedule ok")
```

Expected output: `schedule ok`. To see the retry path itself, point `fetch_profile` at
`https://httpbin.org/status/503` — you should observe five attempts spaced by growing,
randomized delays, then the final 503 returned.

## Gotchas

- **Retrying 4xx responses.** My first version retried everything non-200. Symptom: a
  bad auth token turned into 5 slow failures instead of 1 fast one, and our alert fired
  on latency instead of auth. Escape: allowlist the retryable statuses (5xx + transport
  errors) explicitly.
- **Equal jitter isn't enough under real outages.** I started with `ceiling/2 +
  uniform(0, ceiling/2)`. Symptom: load tests showed retry waves still clustering at the
  half-window mark. Escape: full jitter (`uniform(0, ceiling)`), which the
  [AWS backoff analysis](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
  shows keeps total calls lowest across client counts.

## Sources

- [Exponential Backoff And Jitter (AWS Architecture Blog)](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) — full vs. equal jitter comparison
- [httpx documentation](https://www.python-httpx.org/exceptions/) — TransportError hierarchy
- [Google SRE Book: Handling Overload](https://sre.google/sre-book/handling-overload/) — why synchronized retries amplify outages

## Changelog

- feat: retry wrapper with full jitter ([a1b2c3d](https://github.com/example/fixture/commit/a1b2c3d4))
