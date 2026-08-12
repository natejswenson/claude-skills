/**
 * The four stages, declared once.
 *
 * Everything else reads this: the state machine, the gate, the dispatch-prompt
 * renderer and the run board. A stage that is not here does not exist, and a
 * stage here without a model, an agent type, an artifact and a brief is a hole
 * the corpus baseline goes red on — because a state machine missing a stage
 * still renders as a complete-looking board.
 */

/** Where a stage's answer has to land before the gate will look at it. */
const ARTIFACT = (name) => `${name}.md`;

export const STAGES = [
  {
    id: 'investigate',
    title: 'Investigate',
    model: 'opus',
    agent: 'general-purpose',
    artifact: ARTIFACT('investigate'),
    /** What the subagent is asked to produce. Rendered into the brief verbatim. */
    asks: [
      'Reproduce or locate the behaviour the issue describes. Name the files and',
      'functions responsible, with `path:line` references a reader can click.',
      'State the root cause in one sentence.',
      'State explicitly whether the issue as written asks for the right fix, and',
      'if it does not, say what the reporter probably wants instead.',
      'List what you could NOT determine. An unknown named is worth more than a',
      'guess presented as a finding.',
    ],
    /** Sections the artifact must contain, checked on accept. */
    requires: ['Root cause', 'Evidence', 'Unknowns'],
    forbids:
      'Do not change a single file. This stage reads and reports; an investigation ' +
      'that edited the codebase has destroyed the evidence it was sent to gather.',
  },
  {
    id: 'design',
    title: 'Design',
    model: 'opus',
    agent: 'general-purpose',
    artifact: ARTIFACT('design'),
    asks: [
      'Propose the change. Name the approach chosen AND at least one approach',
      'rejected, with the reason — a design with no rejected alternative is a',
      'first idea wearing a design doc.',
      'List every file that will be touched and what happens to it.',
      'State how the change will be proven: the specific behaviour a test must',
      'assert, phrased so a reader can tell it maps to the issue.',
      'Decide whether this is ONE change or SEVERAL. If several, list the work',
      'items in landing order under a `## Work items` heading, one per line as',
      '`- <slug>: <what lands in this layer>`. Each item must be reviewable and',
      'mergeable ALONE. If one change, say so and write no work items.',
    ],
    requires: ['Approach', 'Rejected', 'Files', 'Proof'],
    forbids:
      'Do not write the implementation. A design doc containing the finished diff ' +
      'is a change nobody got to approve before it existed.',
  },
  {
    id: 'implement',
    title: 'Implement',
    model: 'sonnet',
    agent: 'general-purpose',
    artifact: ARTIFACT('implement'),
    asks: [
      'Make the change described in the approved design, and nothing else.',
      'Match the surrounding code: its naming, its comment density, its idiom.',
      'Commit on the branch named in the brief. Stage explicit paths — never',
      '`git add -A` or `git add .`; another session may hold uncommitted work in',
      'this tree.',
      'Report what you changed as a table of `file | what changed`, and name',
      'anything in the design you did NOT do, with the reason.',
    ],
    requires: ['Changed', 'Deviations'],
    forbids:
      'Do not go beyond the approved design. A better idea found mid-implementation ' +
      'goes back to the design gate; it does not get built because it was noticed.',
  },
  {
    id: 'test',
    title: 'Test',
    model: 'sonnet',
    agent: 'general-purpose',
    artifact: ARTIFACT('test'),
    asks: [
      'Write the test the design named as its proof, in the place this repo already',
      'keeps its tests.',
      'Prove the test is two-sided: show it FAILING against the unfixed behaviour',
      '(revert, stub, or assert the old value) before showing it pass. A test that',
      'was never seen red proves the suite runs, not that the issue is fixed.',
      'Run the suite. Save the real, unedited command output to the evidence file',
      "named in the brief, including the runner's own pass/fail summary lines,",
      'and add a line recording the exit code.',
      'Report the command you ran and its exit code.',
    ],
    requires: ['Command', 'Two-sided', 'Result'],
    forbids:
      'Never report a pass you did not watch happen. If the suite could not run, say ' +
      'so and stop — an unrun suite reported as green is the failure this whole skill ' +
      'is built to prevent.',
  },
];

export const STAGE_IDS = STAGES.map((s) => s.id);

export const stage = (id) => STAGES.find((s) => s.id === id) ?? null;

/** The stage before `id`, or null if it is the first. */
export function previousStage(id) {
  const i = STAGE_IDS.indexOf(id);
  return i > 0 ? STAGES[i - 1] : null;
}

/**
 * Stages that run once for the whole issue, vs once per work item.
 *
 * Investigation and design are about the issue, so a split cannot duplicate
 * them — decomposing an issue does not mean re-deciding what it is. Implement
 * and test are about a change, so each work item gets its own.
 */
export const SHARED_STAGES = ['investigate', 'design'];
export const PER_ITEM_STAGES = ['implement', 'test'];

/** The evidence file the test stage must fill. Named here so the gate and the brief agree. */
export const EVIDENCE_FILE = 'test-output.txt';
