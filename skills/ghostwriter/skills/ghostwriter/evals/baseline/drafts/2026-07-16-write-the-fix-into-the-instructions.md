An AI agent will keep making the same mistake if the fix only lives in your head.

I had an agent generating cover images for a set of blog posts. The first batch rendered fine and looked identical: same layout, one of three rotating shapes. Telling it "make these unique" once didn't stick, because the instructions it re-reads every time never said not to repeat the template.

The fix wasn't code. It was one line added to those instructions, plus a separate rule file the agent checks itself against before it's done: a cover that just repeats the title is a failure. Write the constraint into what the agent reads, not just what you told it once.

Then, to fix all 49 already-published covers without flooding one conversation with 49 rounds of "try again," I split the batch across parallel subagents, each working its own slice in an isolated context, while the main thread just reviewed what came back.

Full write-up in the comments.
