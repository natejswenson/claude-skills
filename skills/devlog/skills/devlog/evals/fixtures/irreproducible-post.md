---
title: "How our pipeline learned to validate itself end-to-end"
date: 2026-07-10
project: fixture
version: v2.1.0
tags: [testing, data-pipelines, python]
summary: "v2.1.0 added self-validating pipeline stages. A look at how the validation layer came together."
---

## Shipped

v2.1.0 wires validation into every pipeline stage. Each stage now declares a schema, and
the runner checks outputs before they flow downstream. This post walks through how the
system fits together.

## The validation layer

The heart of it is the stage wrapper. It pulls the declared schema off the stage and
routes failures to our dead-letter handler:

```python
def validated(stage):
    def wrapper(batch):
        result = stage(batch)
        schema = registry.schema_for(stage)
        for row in result:
            check_row(row, schema, on_error=dead_letter.route)
        return result
    return wrapper
```

`registry` holds all our stage schemas and `dead_letter.route` sends bad rows to the
usual place. With that in place, the runner just wraps everything:

```python
pipeline = build_pipeline(config)
for stage in pipeline.stages:
    stage.fn = validated(stage.fn)
run_pipeline(pipeline, source=events_source())
```

## Watching it work

Once deployed, the validation layer immediately started catching issues. In our repo,
running the nightly job now prints:

```text
[validate] stage=enrich rows=48210 rejected=17 (0.04%)
[validate] stage=aggregate rows=48193 rejected=0
nightly: OK
```

Those 17 rejected rows were exactly the malformed events we'd been chasing for weeks.
The dead-letter queue fills up with them and our dashboard graphs the rejection rate per
stage, which has already flattened out nicely since launch.

## Gotchas

- The main lesson here is philosophical: validation is a journey, not a destination. We
  learned to think of schemas as living documents and to stay flexible about where
  checking happens. Teams should find the balance that works for them.

## Sources

- [Great Expectations documentation](https://docs.greatexpectations.io/docs/) — data validation concepts
- [Designing Data-Intensive Applications](https://dataintensive.net/) — schema evolution background
- [Martin Fowler on ContractTest](https://martinfowler.com/bliki/ContractTest.html) — testing at boundaries

## Changelog

- feat: self-validating stages ([f9e8d7c](https://github.com/example/fixture/commit/f9e8d7c6))
