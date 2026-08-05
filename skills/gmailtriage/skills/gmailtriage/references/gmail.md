# The Gmail surface this is built on

The MCP is **agent-side**. A node script cannot call it, so the division is
fixed: the agent fetches and the agent trashes; `scripts/gmailtriage.js` decides
what a rule may take and refuses anything a rule did not name.

## The operations that exist

| Need | Tool |
|---|---|
| list threads by query | `search_threads` — Gmail query syntax, **50 per page**, paginate with `pageToken` |
| read one thread in full | `get_thread` |
| trash a thread | `apply_sensitive_thread_label` with `labelOption: TRASH` |
| restore a thread | `unlabel_thread` / `unlabel_message` removing `TRASH` |
| user labels | `list_labels`, `create_label`, `label_thread` |

## The operations that do not exist

- **No permanent delete.** `TRASH` and `SPAM` are the only destructive labels.
- **No header access.** There is no `header:` operator and no way to read
  `List-Unsubscribe` directly.
- **No batch trash.** One call per thread; a fifty-thread plan is fifty calls.

## Two fields that are not where you expect them

`search_threads` with the minimal or metadata view returns `labelIds` **without
the `CATEGORY_*` labels**. So `category` and any bulk-mail signal cannot be read
from the main fetch. Both are derived by running the category queries separately
and intersecting the ids:

```
in:inbox                      → the sample
in:inbox category:promotions  → mark those ids promotions
in:inbox category:updates     → mark those ids updates
```

`hasUnsubscribe` is then an **approximation**: a thread in promotions or updates
is treated as bulk. Gmail exposes no header operator, so this is the closest
structural proxy available, and it is named as a proxy rather than a fact.

This is worth knowing before adding a match field: if Gmail cannot express it as
a query, the skill cannot match on it either.
