---
name: req-elicit
description: |
  Collaborative Requirements Elicitation through Discovery Dialogue.
  Use when: (1) User provides vague feature requirements, (2) Starting new feature/project,
  (3) User says "I want to build", "I need a feature", (4) Before generating CL12 contracts,
  (5) When requirements have high ambiguity that would produce theater contracts,
  (6) Refactoring legacy code that lacks contracts (Constitutional Refactoring).
  Triggers: "elicit requirements", "gather requirements", "I want to build", "help me specify",
  "what are the requirements", "clarify requirements", "constitutional refactoring".
  Output: REQUIREMENT_MANIFEST.md with Ambiguity Score under 3.
---

# req-elicit

Collaborative Requirements Elicitation — Work WITH users to transform loose intent into a Requirement Manifest dense enough for CL12 contract generation.

## Philosophy

We are partners in discovery, not interrogators extracting confessions.

The user has knowledge we need. Our job is to help them articulate it clearly, not to make them feel inadequate for not having pre-formed specifications. We draw out requirements through dialogue, not interrogation.

**Méndez Principle**: Rapport-based, non-coercive questioning produces more accurate information than adversarial questioning.

## The Discovery Dialogue Protocol

### Phase 0: Intent Mirroring (Rapport Building + Transcript Capture)

**FIRST**: Capture the user's EXACT words verbatim for traceability.

```markdown
## Source Prose (Verbatim)
> "[Copy user's exact input here, word-for-word, including typos and informal language]"
```

This becomes the **Source Prose** field in the REQUIREMENT_MANIFEST.md. It provides:
- Audit trail back to original intent
- Evidence for contract traceability (CL12-E)
- Protection against scope creep ("that's not what I asked for")

**THEN**: Reflect back understanding:

```
"Let me make sure I understand what we're building together:

[Paraphrase of user's intent in your own words]

Is this accurate? What did I miss or misunderstand?"
```

**Purpose**:
- Capture verbatim input for traceability/audit
- Build trust before probing
- Catch gross misunderstandings early
- User feels heard, not examined
- Creates collaborative foundation

**Exit Criteria**:
1. Verbatim source prose captured
2. User confirms understanding or corrects it

### Phase 1: Collaborative Extraction

Work together to identify:

- **Nouns (Entities)**: What objects, data, actors exist in our system?
- **Verbs (Actions)**: What operations, transformations, behaviors?
- **Relationships**: How do entities connect? (sketch a simple diagram)
- **Boundaries**: What's IN scope vs. OUT of scope for this system?

**Key Question**: "Who else might interact with our system that we haven't mentioned?"

### Phase 1.5: Tension Discovery (Contradiction Detection)

Review extracted requirements for tensions:

```
"I noticed something that might need clarification:

You mentioned [X], but also [Y]. These could work together,
but I want to make sure I understand how.

Help me see how both can be true?"
```

**Purpose**: Surface implicit contradictions without accusation. The framing assumes the USER knows the resolution — we're asking them to share it, not catching them in an error.

**Socratic Elenchus**: Expose contradictions gently so user can resolve them.

### Phase 2: Boundary Exploration (PRE Conditions)

Explore limits together with concrete scenarios:

| Instead of... | Ask... |
|---------------|--------|
| "What happens at the limit?" | "Walk me through what happens when [input] is empty" |
| "Edge cases?" | "If 1000 users call this simultaneously, what should we do?" |
| "Error handling?" | "The external service goes down. What does our user see?" |
| "Validation?" | "Someone pastes garbage into this field. Then what?" |

**Concrete scenarios are easier to answer than abstract categories.**

### Phase 2.5: Integration Specification (Dependency + Sequencing + Wiring)

**Purpose**: Contracts capture end-states, not paths. We need assertions about HOW
state is achieved — a sequencing and dependency layer. Every end-state requirement
implies a chain of component interactions. Each link is a potential wiring failure.
We enumerate them now so contracts and tests cover INTEGRATION, not just components.

**Philosophical basis**: Traditional DbC says "WHAT, not HOW" — correct for component
contracts. For integration contracts, the HOW IS the WHAT. The calling sequence IS the
behavior. "Pool.__init__ calls start_monitoring()" is not an implementation detail —
it is an architectural obligation.

#### A. Dependency Graph (natural language → formal)

For each end-state in S1, identify which components depend on which:

```
"Let's map the dependencies between our components:

Which components need other components to function?
For each dependency: what exactly does A need from B?

Format: [Component A] DEPENDS ON [Component B] for [specific purpose]"
```

#### B. Control Flow Requirements (natural language → sequencing specs)

For each dependency edge in the graph, elicit the sequencing obligation using
**Reverse Chain Walking** (Méndez Principle 2 — comprehensive gathering):

```
"Let's trace how [end state] actually happens, walking backward:

1. [End state] — What DIRECTLY causes this?
   → [Component.method_call]
2. [Component.method_call] — What DIRECTLY triggers this call?
   → [Previous_Component.method_call]
3. [Previous_Component.method_call] — What DIRECTLY triggers THIS?
   → [Event or earlier call]
...continue until we reach the EXTERNAL TRIGGER (user action, timer, network event)

For each step, I need the SPECIFIC caller (class.method), not 'the system'.
If any step has an unnamed caller, we have an unresolved wiring obligation."
```

Each step produces a sequencing spec:
Format: `SEQ-N: [Caller] MUST [invoke callee] [temporal constraint: BEFORE/AFTER/DURING condition]`

#### C. Integration Points Checklist

Every point where Component A's output feeds Component B's input:

```
"Let's list every handoff between components:

For each: What does A pass to B? When? What breaks if this handoff doesn't happen?

These become mandatory test targets — before writing ANY test, this checklist must exist."
```

#### D. Lifecycle Paths

For each component in the dependency graph, require explicit paths:

```
"For [Component], walk me through its full lifecycle:

- INIT: Who creates it? Who starts it? What must be true after startup?
- OPERATE: How does it do its normal work?
- CLEANUP: Who stops it? Who releases its resources? What triggers cleanup?
- ERROR: How does it recover from failure?"
```

**Exit Criteria**:
1. Every link in every chain names a specific caller and callee
2. No step says "the system" or "something triggers"
3. Every component has INIT and CLEANUP paths documented
4. Integration Points Checklist is complete

#### E. Phase 2.5 Completeness Gate (BLOCKING)

**Phase 2.5 is the fallible link.** It is human-dependent and incomplete by design.
If Phase 2.5 misses an integration point, the entire downstream chain is blind:
- /design-by-contract can't specify what wasn't identified
- /adversarial-test-writer won't test what wasn't specified
- /constitutional-audit will pass (no SEQ clause to violate)
- System ships with invisible integration wiring bug

**YOU MUST verify ALL items before proceeding to Phase 3:**

```
PHASE 2.5 COMPLETENESS GATE:
  [ ] All component dependencies graphed (nodes + edges)
  [ ] Every dependency edge has a SEQ clause placeholder
  [ ] Sequencing chains documented (INIT_CHAIN, CLEANUP_CHAIN, ERROR_CHAIN, etc.)
  [ ] Integration points enumerated with IDs (IP-1, IP-2, ...)
  [ ] Every IP has corresponding SEQ-N placeholder for /design-by-contract
  [ ] Lifecycle paths complete for ALL components (INIT + CLEANUP minimum)
```

**BLOCK**: CL12 contract authoring (/design-by-contract) SHALL NOT proceed until
this gate passes. An incomplete dependency graph produces contracts with invisible
gaps — gaps that no downstream tool can detect because the obligation was never declared.

**Meincke Scarcity**: "Each missing integration point is a production bug that no
audit, test, or review will catch — because the obligation was never declared."

### Phase 3: Safety Boundaries (INV — Invariants)

Frame invariants as protection, not restriction:

| Instead of... | Ask... |
|---------------|--------|
| "What is forbidden?" | "What would make our system dangerous? Let's write rules against that." |
| "What must never change?" | "If something corrupted [X], what would break? That tells us [X] must be protected." |
| "Side effects?" | "After this runs, what should definitely NOT have changed?" |

**Adversarial framing for good purpose**: "If a malicious actor had access, what's the WORST they could do? Now we forbid that."

### Phase 4: Observable Outcomes (POST Conditions)

Focus on what users and tests can verify:

| Instead of... | Ask... |
|---------------|--------|
| "What must be true after?" | "If I watched this run, what would I SEE change?" |
| "Return value?" | "How would you PROVE to a skeptic that it worked?" |
| "Success criteria?" | "What evidence would convince you it succeeded vs. appeared to succeed?" |

### Phase 5: Theater Prevention

Collaboratively define the Completion Promise:

```
"Let's make sure we can't fool ourselves:

If someone claimed this was working, how would we call their bluff?
What test could PASS but system still be BROKEN?

This becomes our Completion Promise — what must be TRUE for us to ship."
```

**Ralph Loop Exit**: The Promise must be verifiable by constitutional audit.

#### Spec-Level Theater Detection (Integration Completeness Gate)

**YOU MUST** apply this question to every end-state requirement BEFORE proceeding
to Phase 6. This catches incomplete requirements at the source — before contracts
or tests exist.

```
"For each requirement, let's apply the mock test:

Can we satisfy '[requirement]' with ALL components mocked?

If YES → Our requirement only captures the end-state, not the path.
         We need sequencing specs (from Phase 2.5) that specify the
         integration path. Mocks can fake end-states. Mocks cannot
         fake call sequences.

If NO → The requirement includes enough integration specificity
        that it can't be satisfied by theater."
```

| Requirement | Mockable? | Diagnosis | Fix |
|-------------|-----------|-----------|-----|
| "LSPs reclaimed after idle timeout" | YES — mock timer to say "reclaimed" | End-state only, no path | Add SEQ specs: who starts timer, who triggers reclaim |
| "Pool.__init__ MUST call start_monitoring()" | NO — either __init__ calls it or it doesn't | Integration path specified | Sufficient |
| "Disconnect triggers pool.release() for all refs" | NO — either the call chain exists or it doesn't | Integration path specified | Sufficient |

**Meincke Scarcity**: "Each requirement that can be satisfied by mocks is a production bug waiting to happen."

### Phase 6: Commitment Checkpoint

Before generating the manifest, review decisions:

```
"We've made N decisions together. Let me summarize:

1. [Decision about Zone A]
2. [Decision about Zone B]
...

These become our Hard Invariants — the 'Never' list.
If we need to change them later, we do it consciously, not accidentally.

Ready to proceed with these as our foundation?"
```

**Meincke Commitment**: Explicit confirmation creates accountability.

## High-Entropy Zone Patterns

When ambiguity is detected, name the pattern to create shared vocabulary:

| Pattern | Description | Discovery Question |
|---------|-------------|-------------------|
| **Ghost User** | Entity changes mid-operation | "If this gets deleted while we're using it, what happens?" |
| **Field Shadow** | Data inclusion ambiguity | "When we say 'return user data', does that include internal_notes?" |
| **Re-entry Trap** | Idempotency undefined | "If this runs 5 times accidentally, do we get 5 records or 1?" |
| **Credential Ghost** | Auth state ambiguity | "Authentication fails mid-session. Retry? Fatal? Something else?" |
| **Protocol Ambiguity** | Mutation semantics unclear | "Does this read data or can it change things?" |
| **Silence Paradox** | Success/failure indistinguishable | "If it's quiet by default, how do we know it's working?" |
| **Scope Creep Ghost** | System boundaries unclear | "Is [X] our responsibility or someone else's?" |

## Presenting Unresolved Zones

Frame blockers as collaboration opportunities, not failures:

```
"I've identified N areas where we need to make decisions together:

1. [Zone Name]: [Specific scenario with consequences]
   Options: A) [choice], B) [choice], C) something else?

2. [Zone Name]: [Specific scenario with consequences]
   Options: A) [choice], B) [choice], C) something else?

Which would you like to discuss first?"
```

## Output Format: REQUIREMENT_MANIFEST.md

```markdown
# REQ-YYYY-NNN: [Feature Name]

## CCABDD Governance

Human owns: intent (front) + reality judgment (back).
AI owns: enforcement (middle).
Neither crosses the boundary.

Human MUST confirm real-world effect matches intent.
AI MAY NOT infer success from metrics.

**INV-3**: No discretion. No judgment. Only state.
CONTRACT SHALL NOT execute unless ALL predicates evaluate to TRUE.

Full Actor Responsibility Model: →serena:ccabdd-manifesto

---

## 1. Intent Traceability
- **Source Prose**:
  > "[VERBATIM user input - exact words, including typos, informal language.
  > If multi-turn dialogue, include key exchanges that shaped requirements.]"
- **Our Understanding**: "[Paraphrased and confirmed by user]"
- **Ambiguity Score**: [0-10, must be < 3 to proceed]

## 2. The Actor Matrix
| Actor | Permission Level | Prohibited Actions |
|:------|:-----------------|:-------------------|
| [Actor] | [Permissions] | [Prohibitions] |

## 3. The State Transition
- **Initial State ($S_0$)**: [Pre-condition state]
- **Transformation**: [Action]
- **Terminal State ($S_1$)**: [Post-condition state]

## 3.5 Integration Specification

### Dependency Graph
[Component A] DEPENDS ON [Component B] for [specific purpose]

### Control Flow Requirements (Sequencing Specs)
| ID | Caller | Must Invoke | Temporal Constraint | Breaks If Missing |
|----|--------|-------------|---------------------|-------------------|
| SEQ-1 | [class.method or __init__] | [target.method()] | BEFORE/AFTER/DURING [condition] | [consequence] |

### Integration Points Checklist
| ID | Source (class.method) | Target (class.method) | Handoff Data | Contract Clause |
|----|----------------------|----------------------|-------------|-----------------|
| IP-1 | [caller] | [callee] | [what is passed] | [filled after /design-by-contract] |

### Lifecycle Paths
| Component | INIT (created/started by) | CLEANUP (stopped/released by) |
|-----------|--------------------------|-------------------------------|
| [Component] | [Who creates, who starts] | [Who stops, who releases] |

## 4. Hard Invariants (The "Never" List)
| ID | Category | Invariant |
|----|----------|-----------|
| INV-01 | [Category] | [Statement] |

## 5. High-Entropy Zones (Adjudicated)
| Zone | Question | Resolution | Decided By |
|------|----------|------------|------------|
| [Name] | [Question] | [Decision] | [User/Default] |

## 5.5 Rejected Alternatives
| Decision | Alternative Considered | Why Rejected |
|----------|----------------------|--------------|
| [What we chose] | [What we didn't] | [Rationale] |

## 6. Tool/API Interface Summary
| Interface | Purpose | Mutates State? | Called By | Triggered When |
|-----------|---------|----------------|----------|---------------|
| [Name] | [Purpose] | YES/NO | [class.method] | [event/condition] |

## 6.5 Blocking Dependencies
| Unresolved Zone | Blocks |
|-----------------|--------|
| [Zone if any] | Contract generation, Tests, Implementation |

## 7. Completion Promise (Ralph Loop Exit)
> "[Exact verification criteria]"

## 8. Contract Authority
**Authoritative Source**: `contracts/[name]_contract.py`

REQUIREMENT_MANIFEST.md (this file)
        ↓
contracts/[name]_contract.py
        ↓
tests/test_[name]_contract.py
        ↓
src/[name].py

## 9. Revision History
| Date | Author | Change |
|------|--------|--------|
| [Date] | [Names] | Initial manifest from req-elicit |
```

## Ambiguity Score Guide

| Score | Meaning | Action |
|-------|---------|--------|
| 0-2 | Ready for contracts | Proceed to CL12 generation |
| 3-5 | Minor gaps | Clarify specific zones together |
| 6-8 | Major ambiguity | Work through zones before proceeding |
| 9-10 | Needs more dialogue | Return to Phase 0, rebuild understanding |

## Workflow Integration

```
1. User provides loose prose requirement
2. Run req-elicit (this skill)
3. Phase 0: Mirror intent, confirm understanding
4. Phases 1-2: Collaborative extraction + boundary exploration
5. Phase 2.5: Integration specification (dependency graph, sequencing specs, integration points)
6. Phases 3-4: Invariants + observable outcomes
7. Phase 5: Theater prevention + spec-level theater detection (mock test)
8. Phase 6: Commitment checkpoint
9. Phase 2.5 Completeness Gate (BLOCKING — all IPs enumerated, all edges have SEQ placeholders)
10. Generate REQUIREMENT_MANIFEST.md (Score < 3)
11. Proceed to CL12 contract generation (PRE/POST/INV/ERRORS + SEQ)
12. Pre-test gate: verify every Integration Point has a SEQ clause
13. Ralph loop verifies implementation against contracts
```

## Constitutional Refactoring Application

When encountering legacy code without contracts:

1. **Treat existing behavior as "source prose"**
   - Read the code, tests, and usage patterns
   - Formulate: "This code appears to [behavior]"

2. **Run req-elicit on observed behavior**
   - Phase 0: "I see this code does [X]. Is that the intended behavior?"
   - Surface implicit contracts that were never documented

3. **Discover High-Entropy Zones**
   - Where is behavior ambiguous or inconsistent?
   - Where do tests not match apparent intent?

4. **Generate contract from elicited requirements**
   - Now legacy code has explicit behavioral contract
   - Future changes can be verified against it

## Language Guide

| Avoid (Interrogation) | Use (Collaboration) |
|-----------------------|---------------------|
| "You said X but..." | "I noticed X and Y — help me understand..." |
| "What happens when..." | "Walk me through what happens when..." |
| "You must decide" | "We need to decide together" |
| "This is ambiguous" | "This is an area where we have options" |
| "I cannot proceed until" | "Before we move forward, let's clarify" |
| "Your requirements" | "Our requirements" |

## Constitutional Reference

- **CL12**: Contracts generated from manifest must have PRE/POST/INV/ERRORS + SEQ
- **CL12-E**: Tests must trace to specific contract clause IDs (including SEQ-N)
- **Theater Detection**: Completion Promise must define adversarial verification
- **Spec-Level Theater**: "Can mocked components satisfy this requirement?" If YES → incomplete
- **Integration Contracts**: For integration, the HOW IS the WHAT — sequencing IS behavior
- **Pre-Test Gate**: Every Integration Point must have a SEQ clause before tests are written
- **Strict Constructionism**: Implementation shall perform ONLY declared behaviors
- **Méndez Principles**: Non-coercive, rapport-based elicitation; reverse chain walking
- **Meincke Commitment**: Explicit confirmation creates accountability

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
