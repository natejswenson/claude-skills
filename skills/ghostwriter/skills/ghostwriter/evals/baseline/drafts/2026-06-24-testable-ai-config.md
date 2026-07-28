If you give an AI a personality setting, here's the test for whether it's real: can that number change the result of a unit test? If not, it's decoration the model can ignore.

I hit this adding coaching tones to my fitness agent. You pick how the coach talks: supportive, neutral, hardass, or the default (harsh when you miss your metrics, supportive when you hit them).

The tempting version is to drop "harshness: 9" into the prompt and hope. The model sort of complies, and you can never prove it did anything.

So the dials that matter got wired to a switch: below a threshold the harsh instructions are left out of the prompt the agent builds, above it they go in. Now "hardass produces the harsh version and supportive doesn't" is a line in a test, not a vibe, and a scorer checks every tone on every commit.

If a config value can't flip the output of a test, you didn't build a setting, you built a suggestion. Wire the ones that matter to something deterministic, and let the model handle the rest.
