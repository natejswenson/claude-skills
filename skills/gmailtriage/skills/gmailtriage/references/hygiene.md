# Hygiene: a label system that stays maintainable

A mailbox with rules is not the same as a mailbox that is managed. Rules only
ever answer *"what do my rules take"*. Nothing in that question can see a folder
no rule files into, or two spellings of one folder, or a sender that started
writing last month — so a label system rots quietly while every command still
reports success.

`audit` is the command that asks the other question. Run it every time.

```
gmailtriage audit --labels labels.json --threads threads.json
```

It exits non-zero while anything is outstanding. That is deliberate: a report
nobody has to act on becomes a report nobody reads.

## The three ways a label system rots

### 1. A folder no rule manages

It stays sorted exactly as long as you keep sorting it by hand, and nothing in
Gmail ever mentions that. `audit` splits these in two, because the remedies are
opposite:

| | Means | Fix |
|---|---|---|
| **holds mail** | mail was filed here deliberately and nothing maintains it | write a rule — an *adopt* |
| **and empty** | scaffolding someone made once and never used | delete it; there is no mail in it to lose |
| **count unknown** | the label list came without `threadsTotal` | re-fetch `list_labels` before deciding anything |

That third row matters more than it looks. Guessing "holds mail" from a missing
field tells you to write rules for folders that are empty; guessing "empty"
tells you to delete folders that are not. Not knowing is a real answer.

**Whether to adopt or delete is yours, not the skill's.** A folder emptied last
week still means something.

### 2. One folder, spelled two ways

`Receipts` and `Reciepts` both existed in a real mailbox for months, with mail
split across them and nothing anywhere saying so.

`normaliseLabel` already collapses case and spacing, so `Receipts`/`receipts`
were never two folders. It does **not** catch a transposition, and that is the
common typo. So the check is two tests:

- **sorted letters** — catches any transposition exactly and cheaply
  (`receipts` and `reciepts` are the same multiset);
- **edit distance ≤ 1** — catches a dropped or added character, which
  reordering never sees.

Both floored at 5 characters. Below that almost everything is one edit from
everything, and a hygiene check that cries wolf stops being read — `NPM` and
`PNM` are not the same folder.

Two labels sharing a **leaf** under different parents are deliberately *not*
flagged: `Finance/Receipts` and `Work/Receipts` are two folders someone meant to
have. A typo in the leaf is still caught under any parent.

**Which spelling is right is a question for the user.** The skill can prove two
folders are one; nothing on disk says which name was intended, and folding mail
into the misspelling puts it somewhere they will never think to look.

### 3. Mail no rule claims

Senders that started writing after the rules were written. These do not
accumulate in the inbox — an archived thread that no rule ever claimed sits
outside the inbox forever, which is why the fetch has to include
`has:nouserlabels` and not just `in:inbox`.

Note the question being asked here is **not** the one `plan` asks. `plan` wants
"is there work to do", and answers *no* for a thread already sitting in the
folder its rule files into. That thread is the most claimed thread in the
mailbox. Conflating the two made a live audit report 47 of 48 threads as
unclaimed — a clean mailbox rendered as a broken one.

## Growing, not sprawling

When a cluster has no home, `audit` prints the folders that already exist
alongside it. A new employer's mail belongs at `Recruiting/<name>`; made a
top-level folder instead, the label list grows by one every time anyone new
writes to you, and within a year the sidebar is the problem it was supposed to
solve.

## Merging two folders into one

```
gmailtriage merge --from Reciepts --to Receipts --threads all.json
```

Three operations, and **the order is the whole of it**:

1. apply `<to>` to every thread carrying `<from>` that lacks it;
2. *then* remove `<from>` from all of them;
3. *then* delete the `<from>` label, which is empty by now.

Reversed, every thread spends the gap between two API calls in neither folder —
and a run that dies in that gap leaves it there permanently, with a receipt
describing a mailbox that no longer exists.

**A merge that moves no mail is still a merge.** The real `Reciepts` case was
one thread that already carried `Receipts`, so the whole operation was "remove
the label, delete the folder". Recording nothing would have made it
unreversible — the folder is gone, and only the receipt knows it existed.

`undo` reverses a merge by re-creating the folded folder and putting it back on
exactly the threads that had it, and by removing the target label from only the
threads the merge added it to — never from the ones that already had it.

## Coverage is the number to watch

`audit` reports the percentage of folders that a rule manages. 100% means every
folder stays sorted without you touching it. Anything less names, precisely,
the part of the mailbox you are still maintaining by hand.
