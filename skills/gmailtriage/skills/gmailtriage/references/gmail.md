# The Gmail surface this is built on

The MCP is **agent-side**. A node script cannot call it, so the division is
fixed: the agent fetches, trashes, labels and archives; `scripts/gmailtriage.js`
decides what a rule may take and refuses anything a rule did not name.

## The operations that exist

| Need | Tool |
|---|---|
| list threads by query | `search_threads` — Gmail query syntax, **50 per page**, paginate with `pageToken` |
| read one thread in full | `get_thread` |
| trash a thread | `apply_sensitive_thread_label` with `labelOption: TRASH` |
| restore a thread | `unlabel_thread` / `unlabel_message` removing `TRASH` |
| list the user's folders | `list_labels` — returns `{id, name, type}`; `type: "system"` are Gmail's own |
| create a folder | `create_label` — `Parent/Child` nests |
| file a thread | `label_thread` |
| archive a thread | `unlabel_thread` removing **`INBOX`** |
| un-archive a thread | `label_thread` adding `INBOX` back |

## The operations that do not exist

- **No permanent delete.** `TRASH` and `SPAM` are the only destructive labels.
- **No "move".** Gmail has labels, not folders. A move is `label_thread` plus
  `unlabel_thread` on `INBOX`, and doing only the first tags mail without
  sorting it. See `sorting.md`.
- **No header access.** There is no `header:` operator and no way to read
  `List-Unsubscribe` directly.
- **No batch anything.** One call per thread, per operation. A fifty-thread plan
  that files and archives is a hundred calls.

## Labels are ids in one place and names in another

`create_label` and `label_thread` take a **name**. `search_threads` returns
`labelIds` — opaque strings like `Label_15` for user labels — so a thread's
`labelIds` cannot be compared against a rule's destination without the mapping
from `list_labels`.

This is why `matches()` reads an optional `thread.labels` array of resolved
*names* and simply does not fire when the fetch did not supply them. The cost of
not knowing is one redundant `label_thread` call, which Gmail treats as a no-op;
guessing at the mapping would cost a thread filed in the wrong place.

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
