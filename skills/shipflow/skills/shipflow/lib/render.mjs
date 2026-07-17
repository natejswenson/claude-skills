// Pure template-substitution. No I/O, no gh/git calls — used by both plan.mjs
// (to compute a content-hash for the "would render" side of the hand-edit
// diff) and apply.mjs (to actually write the file). Keeping it here, not
// duplicated between the two, is what makes plan.mjs's hash comparison and
// apply.mjs's write guaranteed to agree.
//
// Required-check names are deliberately NOT a substitution parameter here.
// Native `gh pr merge --auto` takes no check-name input — GitHub gates the
// eventual async merge on whatever live branch protection/rulesets mark
// required, not on anything baked into this workflow file. Baking check
// names in would be a dead parameter at best and an invitation to
// reconstruct the bespoke-polling mechanism (rejected — see the design's
// Fatal #1 discussion) at worst.

const TOKEN_RE = /\{\{(\w+)\}\}/g;

// DEV_BRANCH/MAIN_BRANCH land inside single-quoted YAML string comparisons
// (`... == '{{DEV_BRANCH}}'`) and RELEASE_CREDENTIAL_SECRET lands inside a
// `${{ secrets.X }}` GitHub Actions expression — this function does pure
// string substitution with NO awareness of YAML or GHA-expression grammar,
// so any of these three params can break out of their quoting context if
// not validated first. Concretely: devBranch = "dev' || 'x'=='x" renders
// the auto-merge job's `if:` condition to `... == 'dev' || 'x'=='x'`,
// which is unconditionally true — enabling auto-merge on ANY pull request
// to main, not just genuine dev-branch promotions. A value containing a
// newline in any of the three can inject entirely new YAML keys/steps into
// the committed, then-executed workflow file. This is not a theoretical
// input: config.branches.{main,dev} and config.release.releaseCredential
// come from .github/shipflow.json, a file anyone with repo WRITE access
// (not just the admin who ran shipflow's setup) can edit — a strictly
// lower trust level than the admin-scoped `gh` credential the rendered
// workflow runs with. Found via a Siege security audit (2026-07-15).
const UNSAFE_YAML_STRING_RE = /['\r\n]/;
// GitHub Actions secret names: letters, digits, underscore; cannot start
// with a digit (case-insensitivity aside, this is the full safe charset).
const SAFE_SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Prefix tokens for gitflow's release/*  and hotfix/*  head.ref match guards. Same
// UNSAFE_YAML_STRING_RE validation as DEV_BRANCH/MAIN_BRANCH — these substitute into
// an identical single-quoted YAML string-comparison context.
const TOKEN_VALIDATORS = Object.freeze({
  DEV_BRANCH: (v) => !UNSAFE_YAML_STRING_RE.test(v),
  MAIN_BRANCH: (v) => !UNSAFE_YAML_STRING_RE.test(v),
  MERGE_FLAG: () => true, // closed enum from mergeMethodToFlag — never attacker-shaped
  RELEASE_CREDENTIAL_SECRET: (v) => SAFE_SECRET_NAME_RE.test(v),
  RELEASE_BRANCH_PREFIX: (v) => !UNSAFE_YAML_STRING_RE.test(v),
  HOTFIX_BRANCH_PREFIX: (v) => !UNSAFE_YAML_STRING_RE.test(v),
});

// params: { devBranch, mainBranch, mergeFlag, releaseCredentialSecret }
// mergeFlag is one of "--merge" | "--squash" | "--rebase", derived from
// config.mergeMethod.devToMainMethod by the caller (not this function —
// mapping method name -> gh flag is a config-schema concern, kept out of
// the pure-substitution layer so this function has zero knowledge of the
// config shape, only of the template's token names).
export function renderTemplate(templateSource, params) {
  const missing = [];
  const unsafe = [];
  const rendered = templateSource.replace(TOKEN_RE, (_, name) => {
    const key = TOKEN_TO_PARAM[name];
    if (!key || !(key in params)) {
      missing.push(name);
      return `{{${name}}}`;
    }
    const value = String(params[key]);
    const validate = TOKEN_VALIDATORS[name];
    if (validate && !validate(value)) {
      unsafe.push(name);
    }
    return value;
  });
  if (missing.length > 0) {
    throw new Error(`renderTemplate: missing param(s) for token(s): ${missing.join(', ')}`);
  }
  if (unsafe.length > 0) {
    throw new Error(
      `renderTemplate: unsafe value for token(s): ${unsafe.join(', ')} — branch names must not contain a quote or newline, and the release-credential secret name must match GitHub's secret-naming rules (letters/digits/underscore, not starting with a digit)`
    );
  }
  return rendered;
}

const TOKEN_TO_PARAM = Object.freeze({
  DEV_BRANCH: 'devBranch',
  MAIN_BRANCH: 'mainBranch',
  MERGE_FLAG: 'mergeFlag',
  RELEASE_CREDENTIAL_SECRET: 'releaseCredentialSecret',
  RELEASE_BRANCH_PREFIX: 'releaseBranchPrefix',
  HOTFIX_BRANCH_PREFIX: 'hotfixBranchPrefix',
});

// INV-MP-12: every TOKEN_TO_PARAM key must have a matching TOKEN_VALIDATORS key, or a
// substituted value could reach a template with zero validation (the exact class of
// gap a 2026-07-15 Siege audit found and fixed). Called once at module load against
// the real exported objects; also independently callable so a unit test can assert
// the logic itself (not just today's two maps happening to agree) by passing in
// deliberately-mismatched local fixture objects.
export function assertTokenValidatorsComplete(tokenToParam, tokenValidators) {
  const missing = Object.keys(tokenToParam).filter((key) => !(key in tokenValidators));
  if (missing.length > 0) {
    throw new Error(`assertTokenValidatorsComplete: TOKEN_VALIDATORS missing entr(y/ies) for: ${missing.join(', ')}`);
  }
}
assertTokenValidatorsComplete(TOKEN_TO_PARAM, TOKEN_VALIDATORS);

export function mergeMethodToFlag(devToMainMethod) {
  switch (devToMainMethod) {
    case 'squash':
      return '--squash';
    case 'rebase':
      return '--rebase';
    case 'merge':
    default:
      return '--merge';
  }
}
