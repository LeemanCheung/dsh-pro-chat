# DSH Pro Chat

A persistent DSH Web plugin that uses a **user-authorized, dedicated ChatGPT Chrome session** for long work through the ChatGPT UI's Pro thinking option. Local conversation state lives in a DSH storage domain. A complete transcript can be placed into the current DSH composer only after an owned confirmation step; it is never auto-submitted.

## Evidence boundary

This plugin does **not** claim that Codex OAuth or an OpenAI API key exposes ChatGPT Pro. The Pro path is browser automation through Oracle `0.18.0`, an already logged-in ChatGPT page, and loopback-only Chrome DevTools Protocol.

Before an initial turn, the Host proves one unambiguous ChatGPT target is set to GPT-5.6 Sol + Pro, then pins Oracle to that exact target. The resulting Oracle metadata must prove:

- a completed browser run;
- `gpt-5.6-sol`;
- prompt submission;
- the configured loopback Chrome endpoint;
- the exact initial target;
- a stable `https://chatgpt.com/c/<conversation>` URL;
- `keepBrowser: true` so the actual result target remains available for post-turn proof.

For a follow-up, Oracle resumes the parent's stored conversation URL and may create a new target. DSH requires the parent and child metadata to retain the same endpoint, parent session, and conversation ID, then revalidates Sol + Pro on the **actual child target**. Old Oracle sessions without `keepBrowser: true` fail closed as unverifiable; they are never silently resumed.

Selection proof, an Oracle output file, or an on-disk session directory alone is not a successful turn. Any request that may have reached ChatGPT but fails lineage/post-turn proof becomes `external-diverged`; its result is not committed and the UI warns against automatic retry.

## Browser coordination

- Automatic five-second status refresh is passive: it checks the Oracle install and loopback Chrome reachability only. It never opens a model menu or evaluates page DOM.
- **检查连接** is the explicit active proof action and sends no model request.
- A single exclusive browser lease covers pre-proof, Oracle execution, metadata verification, and post-proof. A second operation fails closed instead of interleaving with the active tab.
- Different local conversations cannot run concurrent turns against the one dedicated Chrome profile.

## Crash-consistent local state

The DSH storage-domain API serializes writes but has no cross-table transaction. Pro Chat therefore uses explicit journals:

- `PREPARING` is written before prompt/chat-lock writes. A failed or crashed prepare is rolled back idempotently; the journal record is deleted last.
- After Oracle returns a validated response, Pro Chat first writes a versioned `pending-finalizations/<turnId>.json` sidecar with a same-directory temporary file and atomic rename. Only then does it write the storage-domain `FINALIZING` record. Startup replays sidecars before domain journals, and clears a sidecar only after the response, chat state, and succeeded turn are all consistent.
- A sidecar/domain conflict or an unrecoverable replay failure becomes `external-diverged`; the preserved sidecar is not treated as proof that the local commit completed.
- Recovery also requires the Domain turn and its unique assistant response to carry the same Oracle session lineage. Conflicts fail closed as `external-diverged` instead of silently choosing either record.
- queued/running turns that survive a restart without a recoverable result also become `external-diverged`, because DSH cannot prove that their prompts were never submitted. The chat records a durable divergence marker and refuses automatic continuation to prevent duplicate submission.
- a valid web result whose local lineage cannot be proven is retained as `external-diverged`, not ordinary retryable failure.

## Recoverable local trash

The default destructive-looking action is **移至本机回收区**, not permanent deletion.

1. Pro Chat snapshots a durable artifact inventory before writing the tombstone. Each transcript, chat-scoped Oracle directory, or exact legacy Oracle session records whether it existed at archive time.
2. The tombstone hides the chat and blocks send, rename, handoff, and concurrent operations.
3. New chats keep Oracle data under `${DSH_HOME}/pro-chat/oracle-chats/<chatId>`, so every success, failure, and cancellation is scoped to that chat.
4. Inventory-owned directories move idempotently to `trash/<chatId>/<opId>`. Restore fails closed if the inventory is missing, an originally present artifact is absent from both live and trash locations, an originally absent artifact unexpectedly appears, or both source and target exist.
5. Messages and turns remain in the domain, so **恢复** can reverse verified moves and clear the tombstone last.
6. Legacy chats move only exact persisted Oracle session IDs. The tombstone no longer imposes a 100-session cap, so long legacy histories are representable without guessing slug prefixes; unlinked legacy directories remain an explicit residual risk.
7. ChatGPT web conversations are never deleted by this action. No automatic permanent purge is provided.

All artifact paths are constructed from validated IDs. Existing sources/targets are checked against the canonical DSH Pro Chat root, and Junctions/symlinks are refused.

## Diagnostics and credentials

- CDP configuration accepts only `127.0.0.1:<port>` or `localhost:<port>`.
- Prompts travel over managed child-process stdin, not command arguments.
- The subprocess environment explicitly removes `OPENAI_API_KEY`.
- Oracle subprocess/page diagnostics use fixed, allowlisted categories; DOM/page output is never copied into the storage domain or UI. Other local storage/filesystem failures are redacted and length-limited but may retain operational text such as a local path, so they are not described as an allowlist.
- The plugin itself does not call Chrome cookie APIs or persist Cookie/OAuth/API-key material. Oracle still has the authority required to automate the dedicated signed-in Chrome profile; never point it at an everyday browser profile.

## First-time setup on Windows

1. Use Node.js 24 or newer.
2. Install the package in a DSH Web Profile.
3. Start a dedicated Chrome profile with CDP on loopback:

   ```powershell
   $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
   $profile = Join-Path $env:LOCALAPPDATA 'DSH\ChromePro'

   & $chrome `
     '--remote-debugging-address=127.0.0.1' `
     '--remote-debugging-port=9222' `
     "--user-data-dir=$profile" `
     '--profile-directory=Default' `
     'https://chatgpt.com/'
   ```

4. Manually sign in to the user's ChatGPT account and select GPT-5.6 Sol + Pro.
5. In **Pro Chat → 连接专用 Chrome**, save the loopback address and choose **检查连接**.

## Validation

The repository is a standalone npm project. A clean checkout requires Node.js 24 and the committed npm lockfile:

```powershell
npm ci
npm run check
npm run tarball:check
npm audit --audit-level=moderate
```

`prepack` and `prepublishOnly` both execute the complete `npm run check` gate. The nested pack allowlist uses `--ignore-scripts`, so lifecycle verification cannot recurse through `npm pack`. GitHub CI repeats clean npm installation and checks on Windows and Linux, exercises the real prepack lifecycle, installs the generated tarball into an empty consumer, and audits the locked dependency tree.

The package prepares version `0.2.0`. The automated gate covers:

- strict schemas and source-owned Host/Client Remote descriptors;
- passive polling with zero DOM evaluation;
- ambiguous-tab failure;
- exact initial target and same-conversation follow-up metadata;
- legacy `keepBrowser=false` refusal;
- allowlisted diagnostics and Node 24 fail-fast;
- prepare recovery, shutdown admission/barrier behavior, atomic pending-finalization sidecars, cross-table lineage conflicts, restart divergence locking, and injected write failures;
- selection ownership across delayed five-second refreshes, failed detail loads, and foreground sends;
- recoverable trash/restore, durable artifact inventories, missing-artifact refusal, long exact-only legacy histories, conflicts, and link escape;
- generated-artifact/source parity, deterministic rebuilds, and an exact package allowlist derived from the public exports.
- standalone configuration/lockfile ownership, source-map containment, non-recursive release lifecycle, and installed-tarball export resolution.

`tests/ui-fixture.html` is a manual-only browser fixture. It is excluded from the npm package and automated gate; it is not a live DSH Profile, ChatGPT model, or production UAT.

These checks do not substitute for an authorized real two-turn ChatGPT Pro UAT. Production acceptance still requires one fresh initial turn, a follow-up in the same Oracle conversation, a confirmed DSH draft handoff that does not auto-send, reload/restart persistence, and long-running browser stability.
