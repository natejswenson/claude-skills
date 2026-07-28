I gave my AI running coach a memory this week. Storing facts was the easy half; the hard half was keeping it from inventing the rest.

A memory section in a prompt is just more context to autocomplete from. Hand the model a vague summary like "consistent lately" and it fills in specifics you never stored.

Two rules made it trustworthy:

1. Compute the memory in code. Adherence streaks and notable results get written as short, dated fact lines, never prose summaries.

2. Put the contract in the block itself. The header states: cite only the facts listed below. Empty list, no callbacks.

The coach still sounds like it knows me. Every "that's three misses in a row" now traces to a line I can point at.
