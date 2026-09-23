# Architecture decision records

An architecture decision record (ADR) captures one significant technical decision: the context that forced it, the option chosen, the alternatives rejected and the consequences we accept. Records are short, written at the time of the decision, and never edited to say something different later. When a decision is reversed, a new record supersedes the old one and the old one's status changes to "Superseded by ADR NNNN".

Each record lives in this directory as `NNNN-short-title.md` with the sections **Status**, **Context**, **Decision**, **Alternatives considered** and **Consequences**, matching the existing record.

## Records

| Number | Title                                                                | Status   |
| ------ | -------------------------------------------------------------------- | -------- |
| 0002   | [Transactional email provider](0002-transactional-email-provider.md) | Accepted |

## Why the numbering starts at 0002

`0001` was never written. The first record committed to the repository was numbered `0002`, and renumbering it would break the references to "ADR 0002" elsewhere in the documentation. New records continue from `0003`; do not reuse `0001`.
