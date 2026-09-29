Status: Done
Date: 2026-09-29

# Fix RTF \uN fallback duplication in stripRtf

## Context

`stripRtf` in `src/tools/documents.ts` (slug 0006) extracts plain text from
RTF embedded documents. It processes `\uN` unicode escapes and `\'NN` hex
escapes as two independent regex passes.

RTF encodes non-ASCII characters as a `\uN` escape immediately followed by a
`\'NN` hex fallback for non-Unicode-aware readers. For example, `á` is
encoded as `\u225 \'e1`. The current code converts both independently:

1. `\u225` → `á` (correct)
2. `\'e1` → `á` (the fallback — should have been consumed, not converted)

This produces duplicated characters: `název` becomes `ná ázev`, `ž` becomes
`ž ž`, `případ` becomes `př øí ípad`, etc. All diacritics are broken this
way.

## Decision

Change the `\uN` regex to also consume the optional `\'NN` hex fallback that
follows it. The regex `\\u(-?\d+)\??` becomes
`\\u(-?\d+)\??\s*\\'(?:[0-9a-fA-F]{2})?` — it matches `\u225` plus the
optional ` ` space and `\'e1` fallback, but only emits the Unicode
character, discarding the fallback.

The existing standalone `\'NN` handler stays unchanged for documents that
use hex escapes without a preceding `\uN`.

## Consequences

- `src/tools/documents.ts`: one-line change to the `\uN` regex in
  `stripRtf`.
- Diacritics are preserved correctly — `název` instead of `ná ázev`.
- Documents using `\'NN` without a preceding `\uN` are unaffected.
- `.agent/design.md` and `.agent/tasks.md` need no change — the function's
  contract (plain text extraction) is unchanged, only its output quality
  improves.
