# Local reliability and interaction review — October 25

Status: deployment authorised by the user. Backend api v24 deployed on October 25 and all four deployed files read back with exact equality. Waiting-table scheduling migration applied. Frontend PR #8 is awaiting the final browser checks; the release checkpoint below will record the final outcome. No historical accounts or hand records are deleted.

## Findings and changes

- Table realtime updates previously also re-read the entire ledger and participants. Game actions awaited every resource, including chat and reactions. Separate game/chat/account refresh paths now prevent unrelated slow reads from holding up betting acknowledgement.
- Polling, subscription callbacks, reconnect, focus and commands could issue parallel reads of the same resource. Refreshes are serialized with one shared trailing request. A notification received during a read is retained. Callers finish without waiting for an endless stream of later notifications.
- Previously fetched private cards were re-read throughout the same hand. They are cached by hand ID; new hands still fetch the authenticated player's private cards. Failed reads preserve the last known state.
- TableRoute now remounts by table ID. Switching tables cannot carry the former table's version guard or visible state into the new table.
- Empty/transient table reads no longer silently navigate to the lobby. Initial connection failure has a reconnect action, and an existing table remains visible during recovery.
- Hidden/offline tabs pause periodic transport polls and presence heartbeats; visibility/online/focus resumes refresh. This does not stop authoritative server hand progression.
- A failed auth mirror restore no longer discards the identity and signs in as a different anonymous player. Explicit sign-out still clears the mirror. Concurrent session initialization is shared. Realtime-auth promise rejection is handled.
- Installed navigation serves the versioned cached shell immediately; a test confirms it never intercepts API/game-data requests.
- The update pill is hidden while on a table route, avoiding an accidental mid-hand refresh.
- Invite loads are cancelled logically when leaving the page; an old response cannot navigate the user back. Failed invites have an in-place retry.
- Timer jobs process up to three independent tables concurrently, with duplicate IDs removed and errors isolated. Existing CAS/receipt logic is unchanged.
- Voluntary runout copy distinguishes “Run out now” (the accessible label and vote panel explain that betting ends) from “Two boards · keep betting.” This is the app's agreed house rule, not a claim about universal poker rules.

## Recovered approved work

Opponent cards remain private during all-in voting; a first “once” vote does not reveal while others are deciding. On all responses, once wins unless all select twice; at the existing deadline, once is the default. Voluntary two-board betting keeps cards private until betting closes. Contested showdown hold: six seconds.

Three-minute inactivity uses last seated-player presence, not automated game events. Waiting rooms receive timers; abandoned live hands settle and record before closure. Cash stacks are returned through ledger exits; no historical accounts are deleted. The local scheduling migration wakes old waiting rooms after the new engine is deployed. Last Player Standing departure removes active dashboard membership while retaining the stack in play. API regression passes against Postgres in GitHub Actions.

## Live read-only evidence

Supabase logs queried for the preceding 24 hours. This window mixes human and CI traffic and cannot attribute a specific user's freeze. Origin timings for table reads: median 45 ms, p95 524.9 ms, maximum 30,146 ms (29,728 requests). Internal allin_load maximum 78,808 ms. Edge command endpoint: median 1,194.5 ms, p95 4,740 ms, maximum 81,074 ms across 2,904 requests, including two 5xx responses. These outliers demonstrate backend delays too; local frontend improvements do not prove they are solved.

## Verification and limits

79 engine tests and 27 server tests pass, including database-backed accounting, host-only table closure, duplicate-request safety and Last Player Standing departure. Web and server typechecks pass. All 31 local Chromium browser checks pass. CI also runs the layout checks in Firefox and WebKit and full separate-player journeys in Chromium and WebKit.

The API test helper now advances to the actual private-state presentation deadline; its old assumption that a hole-card deal was always longer than a flop reveal failed after faster dealing. The action guard remains intact.

Browser fixture checks cover refresh bursts, retained trailing updates, timeout recovery, identity preservation, cached private cards, separation of chat from game reads, setup failures, folded-hand privacy, showdown presentation and portrait/landscape geometry through nine seats. Fixtures are not hosted multiplayer certification. Real iOS/Android hardware remains untested, and no production latency improvement is claimed solely from a passing build.

## Host controls and final refinements

Hosts have Delete table in both waiting and running tables. A running hand finishes and records before closure; cash chips are returned exactly once. Non-host attempts are forbidden. Leaving remains a separate action. Inactivity is based on player presence rather than timer traffic, with a three-minute threshold and current-hand settlement before closure.

Simple labels include History, Profile, Add chips, Leave table and Delete table. Dealing uses 320 ms travel and 220 ms gaps without compressing a full table; runout street spacing is 1,700 ms and contested showdown holds six seconds. Shared presentation timing preserves the complete betting window. Origin-scoped CORS preflights cache for ten minutes to reduce redundant command round trips.

## Release priorities

Verify the complete patch against an isolated database and separate hosted identities before declaring the release verified. Measure action-to-confirmation and update latency during a nine-player session, reconnect, background/foreground, table switching and long chat. Investigate remaining slow backend phases using existing command timing logs; do not assume every delay is cold start or mask it with longer test waits. Preserve action IDs on any future retry work so uncertain bet/rebuy responses cannot duplicate transactions. Do not introduce automatic betting, hide stalled connections, or change shuffle probabilities for presentation.

Design direction: reserve animation for meaningful events, keep decisions responsive, keep a small connection indicator while retaining the table, keep accounts/history inspectable, and make Last Hand the place to revisit results rather than extending everyone's forced wait. Prioritize these over adding further features.
