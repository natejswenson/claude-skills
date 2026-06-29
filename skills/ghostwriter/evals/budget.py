"""Cost cap + mock mode for the ghostwriter LLM eval harness.

Enforces the standing rule for any job that spends LLM money: estimate the spend
up front, hard-cap it in code with a PRE-CALL gate, and provide a `--mock` mode
so the harness logic runs at $0 (and is testable in CI without an API key).

Pure, dependency-free, deterministic — fully unit-testable.
"""
from __future__ import annotations

import os

# Conservative blended USD per 1K tokens (input+output), rounded UP so the cap
# errs on the safe side. Not billing-accurate — a guardrail, not an invoice.
_PRICE_PER_1K = {
    "claude-haiku-4-5": 0.005,
    "claude-sonnet-4-6": 0.018,
    "claude-opus-4-8": 0.090,
}
_DEFAULT_PRICE = 0.02
DEFAULT_MAX_SPEND = 0.50  # USD per run; override with --max-spend


class BudgetExceeded(RuntimeError):
    """Raised by the pre-call gate before a call that would breach the cap."""


def estimate_usd(text: str, model: str, *, output_tokens: int = 600) -> float:
    """Conservative spend estimate for one call.

    ~4 chars/token for the input, plus an assumed output budget. Over-estimates
    on purpose so the gate trips early rather than late.
    """
    in_tokens = max(1, len(text) // 4)
    price = _PRICE_PER_1K.get(model, _DEFAULT_PRICE)
    return round((in_tokens + output_tokens) / 1000 * price, 4)


def mock_enabled(flag: bool) -> bool:
    """Mock if --mock was passed OR no API key is present (fail safe to $0).

    The second clause means CI — which has no ANTHROPIC_API_KEY — never makes a
    live call even if a caller forgets --mock.
    """
    return bool(flag) or not os.environ.get("ANTHROPIC_API_KEY")


class Budget:
    """Cumulative spend tracker with a hard pre-call gate."""

    def __init__(self, max_spend: float = DEFAULT_MAX_SPEND):
        self.max_spend = max_spend
        self.spent = 0.0

    def guard(self, estimate: float) -> None:
        """Abort BEFORE a call whose estimate would push spend over the cap."""
        if self.spent + estimate > self.max_spend:
            raise BudgetExceeded(
                f"Estimated spend ${self.spent + estimate:.4f} would exceed the "
                f"${self.max_spend:.2f} cap. Aborting before the call. "
                f"Raise it with --max-spend if this is intended."
            )

    def record(self, actual: float) -> None:
        """Record actual spend after a successful call."""
        self.spent += actual
