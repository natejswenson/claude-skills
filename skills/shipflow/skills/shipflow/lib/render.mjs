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

// params: { devBranch, mainBranch, mergeFlag }
// mergeFlag is one of "--merge" | "--squash" | "--rebase", derived from
// config.mergeMethod.devToMainMethod by the caller (not this function —
// mapping method name -> gh flag is a config-schema concern, kept out of
// the pure-substitution layer so this function has zero knowledge of the
// config shape, only of the template's token names).
export function renderTemplate(templateSource, params) {
  const missing = [];
  const rendered = templateSource.replace(TOKEN_RE, (_, name) => {
    const key = TOKEN_TO_PARAM[name];
    if (!key || !(key in params)) {
      missing.push(name);
      return `{{${name}}}`;
    }
    return String(params[key]);
  });
  if (missing.length > 0) {
    throw new Error(`renderTemplate: missing param(s) for token(s): ${missing.join(', ')}`);
  }
  return rendered;
}

const TOKEN_TO_PARAM = Object.freeze({
  DEV_BRANCH: 'devBranch',
  MAIN_BRANCH: 'mainBranch',
  MERGE_FLAG: 'mergeFlag',
});

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
