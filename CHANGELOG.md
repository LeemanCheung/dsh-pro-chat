# Changelog

## 0.2.0

- Made the repository self-contained for GitHub/npm release with a package-owned TypeScript/bundling toolchain, npm lockfile, cross-platform CI, non-recursive lifecycle gates, source-map ownership checks, and an installed-tarball consumer smoke test.
- Made automatic transport polling passive and placed all active browser work behind one exclusive lease.
- Bound initial runs to an exact target and follow-ups to verified Oracle parent/child conversation lineage with `keepBrowser` post-proof.
- Added `external-diverged` handling for submitted-but-unverified web turns to prevent blind retries.
- Added durable `PREPARING` journals plus atomically renamed pending-finalization sidecars, replayed before `FINALIZING` reconciliation.
- Bound sidecar filenames and every response/chat/turn/role/Oracle field to one lineage; incomplete, corrupt, or cross-table-conflicting finalization records fail closed, while cancel and shutdown wait for the prepare barrier and shutdown closes new-send admission synchronously.
- Changed leftover queued/running restart state to `external-diverged` and durably blocked automatic continuation when submission cannot be disproved.
- Replaced irreversible local deletion with tombstoned, chat-scoped, recoverable trash and a restore UI; tombstones now own an exact artifact inventory and fail closed on missing or conflicting assets.
- Removed the legacy tombstone's 100-session ceiling while retaining exact-ID-only ownership.
- Added explicit confirmations before replacing a DSH draft or moving local data to trash.
- Made list refreshes selection-safe and paused them during user mutations; stale refresh results and errors cannot replace a committed selection, and a failed detail load cannot redirect the next send away from the displayed chat. Confirmation backgrounds are inert and post-action focus is explicitly restored.
- Restricted persisted Oracle diagnostics to fixed categories and required Node.js 24+.
- Replaced drift-prone generated Remote duplication with one source-owned strict Host/Client descriptor contract.
- Added automated transport, lineage, failure-injection, sidecar recovery, quarantine-ledger, Remote-contract, generated-output, deterministic-build, and strict pack-allowlist coverage.
- Recorded the recovery-only real-Chrome UI fixture as separate manual evidence; it is not part of the automated check and is not live DSH, model, or production UAT.

## 0.1.0

- Added persistent ChatGPT UI browser conversations in a top-level DSH view.
- Added fail-closed CDP proof of GPT-5.6 Sol + Pro on the exact tab Oracle reuses, with post-turn revalidation.
- Added native Oracle follow-up lineage and complete-transcript handoff into the current DSH composer draft.
- Added loopback-only CDP configuration, cancellation, restart recovery, and secret-safe diagnostics.
