A 75% success rate on your agent sounds shippable. Run it three times in a row and the odds all three pass drop to 42%.

That gap is the number most agent evals miss. Anthropic's new piece on evals names it: pass^k, the probability every trial in a row succeeds, not just one of them. pass@k asks "did it work at least once" and flatters you. pass^k is what a user feels, because they don't get to retry until it works.

For anything customer-facing, average accuracy is the wrong target. Measure how often it succeeds every single time, and optimize that.
