Switched my AI fitness coach from the Anthropic API to opencode with a local model.

The cost part is simple. OpenCode is MIT licensed. Inference runs on Gemma 4 via Ollama. No subscription. No per-token billing.

The speed part is the real tradeoff. Local models are slower than Opus 4.8 and less precise at following instructions. My shadow run showed 0.0% invention rate and 12/12 schema compliance, but I still hit cases where the model skips details a frontier model wouldn't miss. That's the honest cost of free.

What makes it worth it is no lock-in. OpenCode routes across 75+ providers. I run a cheap local model for my coaching agent and can point a frontier model at build work. All from the same config.

Is this the beginning of the move away from Anthropic? What models should I try?
