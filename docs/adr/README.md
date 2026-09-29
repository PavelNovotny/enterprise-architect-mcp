# Architecture Decision Records (ADR)

> Lightweight methodology for capturing architectural decisions in this project. Each ADR records
> a single decision, its context, and its consequences — so a future contributor can understand
> *why* the code is the way it is without excavating commit history.

## What is an ADR?

An Architecture Decision Record is a short markdown file that captures one architectural
decision:

- **Context** — what problem forced the decision and what options were on the table.
- **Decision** — what was chosen, stated concretely.
- **Consequences** — what becomes easier, harder, or explicitly rejected as a result.
- **Alternatives** — why each rejected option lost, briefly.

ADRs are **immutable once accepted**. If a decision is reversed, the original ADR is marked
`superseded by ADR-NNNN` and a new ADR is written — never edited in place.

## Directory layout

```
docs/adr/
├── README.md          ← this file — methodology and conventions
├── INDEX.md           ← chronological table of all ADRs
└── NNNN-kebab-title.md ← individual ADRs, numbered from 0001
```

The `0000-template.md` file is the template — copy it to start a new ADR, then delete
the template line at the top.

## File naming

`NNNN-short-kebab-title.md`

- **NNNN** — zero-padded sequential number, starting at `0001`. The template is `0000`.
- **short-kebab-title** — 3–6 words, lowercase, hyphen-separated. Example:
  `0003-use-like-ranking-over-fts5.md`.

## ADR structure

Each ADR follows the template in [`0000-template.md`](0000-template.md):

| Section          | Purpose                                                    |
|------------------|------------------------------------------------------------|
| Front matter     | `adr-id`, `title`, `date`, `status`, `deciders`, `tags`    |
| Status           | `proposed` → `accepted` → `deprecated` / `superseded`      |
| Context          | Problem, constraints, options considered                   |
| Decision         | The chosen approach, stated concretely                     |
| Consequences     | Positive and negative impacts, follow-up work             |
| Alternatives     | Why each rejected option lost                              |
| References       | Links to related ADRs, solution docs, plans, issues        |

## Status lifecycle

```
proposed ──→ accepted ──→ deprecated
                   │
                   └──→ superseded by ADR-NNNN
```

| Status         | Meaning                                                        |
|----------------|----------------------------------------------------------------|
| `proposed`     | Draft — under discussion, not yet binding                      |
| `accepted`     | Decision is final and active in the codebase                   |
| `deprecated`   | Decision is no longer relevant (feature removed, tech retired) |
| `superseded`   | Replaced by a later ADR — the `by ADR-NNNN` clause names which |

A `proposed` ADR that is rejected should be deleted — only accepted decisions (and
their supersessions) belong in the record.

## When to write an ADR

Write an ADR when a decision:

- Is **hard to reverse** — technology choices, data model, public API surface.
- Has **multiple viable options** — if there's nothing to trade off, there's nothing to
  record.
- Affects **more than one component** or sets a pattern others will follow.
- Would prompt **"why did we do it this way?"** from a future contributor.

Do **not** write an ADR for:

- Bug fixes (use `docs/solutions/test-failures/` or a commit message).
- Implementation plans (use `docs/plans/`).
- Design patterns discovered after the fact (use `docs/solutions/design-patterns/`).
- Tooling tips or conventions (use `docs/solutions/tooling-decisions/` or
  `docs/solutions/conventions/`).

The `docs/solutions/` tree captures *patterns and findings*; ADRs capture *decisions*.
If a solution doc already records the reasoning for a decision, the ADR can reference
it rather than duplicate it.

## Relationship to existing documentation

| Document type       | Location                  | Question it answers              |
|---------------------|---------------------------|----------------------------------|
| ADR                 | `docs/adr/`               | *Why did we decide X?*            |
| Plan                | `docs/plans/`             | *How will we implement X?*        |
| Solution / pattern  | `docs/solutions/`         | *How does X work, and what pitfalls does it have?* |
| Concept             | `CONCEPTS.md`             | *What does term X mean in this project?* |

## Writing workflow

1. **Copy the template**: `cp docs/adr/0000-template.md docs/adr/NNNN-your-title.md`
2. **Pick the next number**: check [`INDEX.md`](INDEX.md) for the highest existing number.
3. **Fill in the sections**: context first, decision second, consequences third.
4. **Set status to `proposed`** and share for review.
5. **On acceptance**: change status to `accepted`, add the entry to `INDEX.md`.
6. **On supersession**: write a new ADR, update the old one's status to
   `superseded by ADR-NNNN`, update `INDEX.md`.

## Conventions

- One decision per ADR. If a decision has sub-decisions, write separate ADRs and
  cross-reference them.
- Write in the present tense — "We choose", "The server opens", "This means".
- Link to source files with relative paths: `src/database.ts:42`.
- Link to related docs with relative paths: `docs/solutions/design-patterns/...`.
- Keep ADRs under 300 lines. If the context is long, summarize and link to a plan
  or solution doc for detail.
- Tags in front matter should match the project's existing tag vocabulary where possible.
