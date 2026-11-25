# ADR-016: A shared library of the squad's last ten runs, for replay

Status: accepted

Date: 2026-11-25

## Context

Andrew asked for a replay option on the campaign squad page, so a person can replay a recent run instead of starting a new one each time, with the last ten runs stored centrally. A squad run already saves to `arch_orchestrations`, but that table is scoped to one evaluator (`subject`), so nobody else can see the run, and its events carry no times, so a replay could only step at a fixed pace.

## Decision

- **One shared table.** `team_run_library` (migration `0008`) holds the run log of the ten most recently updated squad runs, any brand, mode or provider, with no `subject`. `settle()` upserts the run each time it stops (waiting on a person, finished or stopped) and then deletes every row past the ten newest. A failed library write is logged and never fails the run.
- **A time for every event.** A run records when it emitted each event (`TeamRun.stamps`). A run resumed after a person's decision only stamps the events it sends, so the library lines the earlier events up with the times it already holds.
- **Readable by anyone.** `GET /api/arch/team/library` lists the runs without their logs; `GET /api/arch/team/library/:id` returns one log with its times. Both are open to every persona: a replay reads, calls no model and takes no decision.
- **Kept until replaced.** The library keeps the last ten runs until newer runs push them out; rows are not removed by the 24-hour architecture prune. Run logs are agent transcripts, so this is an exception to the 24-hour transcript retention in Section 17, approved by Andrew on 2026-11-25 for this table only. The cap bounds what is held: at most ten runs of fictional sample data, with no customer data.
- **Replay on the page.** The page plays a run back through the same reducer a live run uses, waiting the gap the run had between events, with a wait longer than 1.5 s (a person deciding, a slow model call) cut to 1.5 s at 1×. A reader picks 1×, 2×, 5× or Instant, can pause, and can skip to the end. A run with no times plays at a fixed 220 ms per event.

## Consequences

- A replayed run may be someone else's; the page does not remember it as the reader's own run, and its decisions can't be taken while it plays.
- The library always holds the ten latest runs, however old. Everything else in the architecture tables still expires after 24 hours.
- `team-library.worker.test.ts` covers the times, the cap, the routes and that the 24-hour prune leaves the library alone; `apps/web/src/team/replay.test.ts` covers the pacing.

## Supersedes

none
