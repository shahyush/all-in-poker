# All In — complete Claude Code handoff

Prepared for Tanisha Maheshwari and Aayush Shah • 21 October 2026 • Review R4 of the supplied Round 3 export.

**Your assignment is to build, debug, secure and host the complete phone PWA. Deliver a real URL that friends can use. Do not return another design board, disconnected screens, scripted game or implementation plan as the final result.**

Read this file completely, then `HANDOFF.md`, `REVIEW.md`, `RELEASE_CHECKLIST.csv`, and the original wireframe. Inspect the existing project before editing it. Follow the execution stages in HANDOFF.md. Preserve everything already working that is compatible with these requirements.

## Context and priorities

- Private poker for friends, with valueless play chips. No payments, money deposits, redeemable chips or rake.
- Easy entry: group admission plus each person's own private identity. No email, phone number or OTP.
- Phone only: portrait and landscape, browser and installed PWA. No desktop/tablet design project.
- The current design is a simulation. It is not a secure multiplayer implementation.
- Tanisha wants a premium, confident, fun product, with concise copy and visible dealing animations. Ease of play matters more than decorative complexity.
- Correct poker, privacy, complete journeys and reliability come before visual embellishment.
- No paid services, upgrades, custom-domain purchases or billable resources without explicit approval. Never ask for passwords or secret keys in chat.
- Use authorised integrations/CLI sessions yourself. Ask the user only for an account login/approval you cannot perform, or an actual blocking product choice. Give one specific action at a time.

## What the review actually established

The supplied logic checks passed, but 23 of 24 additional targeted checks failed on Round 3. One check confirmed that an apparently questionable short-all-in behaviour was correct. The local correction candidate passes all 24. Five serious defects also reproduce in the freshly retrieved existing server engine. None of these server defects has been deployed away by this review.

Additional local evidence: 2,250 varied hands, 640 hands across 16 continuing sessions, 8,000 evaluator comparisons, all 2,598,960 five-card category counts, and 37 animation-planning cases. These are pure-code tests, not production, browser, security or multi-client certification. See REVIEW.md for exact scope and the four legacy test contract adaptations.

**This is a reviewed implementation handoff, not a release certificate.** The rendering of the supplied export could not be independently browser-tested in this review environment. Real Safari, keyboard, rotation, installed mode, multiplayer, operational timers and final hosting remain mandatory release gates. Never mark them passed from a simulator result.

## Package map

| File/folder | Purpose |
|---|---|
| HANDOFF.md | Canonical build contract, rule resolutions, complete journeys, visual/motion specification, architecture, migration, hosting and completion criteria |
| REVIEW.md | Source-grounded findings, evidence limits, remaining gaps, verification results |
| RELEASE_CHECKLIST.csv | Original acceptance inventory plus R4 gates; production statuses remain open |
| RULE_DECISIONS.json | Explicit recommended launch choices; distinguishes user requirements from reviewer defaults |
| CLAUDE_CODE_PROMPT.txt | Paste into Claude Code with this package available locally |
| source/Round_3_original.zip | Exact supplied export, including design files, earlier packs and archives; provenance, not the latest contract |
| source/Original_Wireframe_Text.txt and .docx | Original full requirements, preserved unchanged |
| reference-candidate/ | Local simulator corrections and a tested animation event planner; integration input, never a production authority/security boundary |
| existing-backend/ | Fresh read-only source retrieval from the existing Supabase functions; contains known defects, not a deployment bundle |
| tests/ | Runnable local audit, stress, session, evaluator and animation checks |
| evidence/ | Actual JSON results and read-only infrastructure metadata |
| SOURCES.md | Official external references consulted; recheck current platform limits before deployment |
| MANIFEST.sha256 | File integrity manifest |

The original export contains old prompts, D01–D12 provisional language and archived implementations. Do not merge their contradictory defaults indiscriminately. Latest explicit user instructions override everything. HANDOFF.md records the recommended implementation resolution for each known conflict; these are not falsely presented as past user approvals. Original undisputed requirements remain mandatory.

Use the existing backend only after reinspection and repair. Use the design export as a visual/interaction reference. Build one shared, typed server game engine with a separate presentation layer. Do not ship both the old server engine and local Journey as competing authorities.
