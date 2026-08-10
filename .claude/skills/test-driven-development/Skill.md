---
name: test-driven-development
description: Enforce RED → GREEN → COMMIT → REFACTOR cycle with constitutional adherence, quality gates, and evidence-based completion
---

# Test Driven Development Skill

## Constitutional Adherence

This skill enforces constitutional TDD principles foundational to all development work:

- **CL6 (TDD Enforcement)**: Write tests FIRST, then implementation. RED → GREEN → COMMIT → REFACTOR is not optional. Refactoring without re-evaluating test adequacy violates TDD.

- **CL2 (Completion Gates)**: Tasks not complete until ALL protocol + quality requirements are met.

- **CL5 (Human Approval)**: Planning phase, AI Panel feedback, and explicit user approval are required before coding.

Skills provide **operational procedures** that execute these constitutional principles. The principles themselves are defined in the constitutional framework loaded at session start.

## TDD Cycle (MANDATORY)

### RED Phase
1. **Write Failing Test First**
   - Write test that describes desired behavior
   - Test MUST fail (if it passes, you're not testing new behavior)
   - Cover edge cases and error conditions
   - Document test rationale in docstrings

**Evidence Required**: Test file created/modified, test runs and FAILS with expected error

### GREEN Phase
2. **Implement Minimal Code**
   - Write simplest code that makes test pass
   - No premature optimization
   - No adding features not covered by tests
   - Prefer clarity over cleverness

**Evidence Required**: Test runs and PASSES, code implements ONLY what test requires

### COMMIT Phase
3. **Commit with Verbose Message**
   - Format: `[AGENT_ID] Brief description\n\nWHY:\n- Rationale\n\nEXPECTED:\n- Outcome\n\nRefs: #issue`
   - Example: "WHY: Audit 2252 requires age validation. EXPECTED: Rejects ages <0 or >150"
   - Commit BEFORE refactoring

**Evidence Required**: Git commit hash, commit message follows format

### REFACTOR Phase
4. **Refactor While Green**
   - Improve code structure while tests stay green
   - Apply DRY, Separation of Concerns, functional patterns per QS2
   - Re-evaluate test adequacy after refactoring
   - If behavior changes, write NEW tests FIRST (CL6)

**Evidence Required**: Tests still pass after refactor, no test changes unless behavior changed

## Quality Standards (QS1 Reference)

- **Coverage**: >85% code coverage required
- **Edge Cases**: Must test boundary conditions, error states, invalid inputs
- **Test Types**: Unit tests (mandatory), integration tests (required), property-based tests (where applicable)
- **Test Independence**: Each test runs independently, no shared state
- **Fast Feedback**: Unit tests complete in <1s, integration tests <10s

## Multi-Agent TDD Context

**When working in orchestrator/agent coordination or adversarial TDD**:

Use **sub-agents** for test writing and implementation (not direct writes):
- Coordinator invokes **test-writer** sub-agent (RED phase)
- Coordinator invokes **coder** sub-agent (GREEN phase)
- Adversarial separation enforces self-documenting tests

**Adversarial TDD Quality Gates**:
1. test-writer BLIND to implementation → Guidance = BEHAVIOR (WHAT, not HOW)
2. coder BLIND to test source → Error messages = complete specifications
3. Theater test detection: Exact values for deterministic problems
4. Ask: "Can implementation be wrong and test still pass?" If YES → Theater test → REJECT

**References**:
- CLAUDE.md SUB-AGENT INVOCATION GUIDE for prompt templates
- ~/.claude/skills/theater-test-detection/ for detection methodology

**When NOT to use sub-agents**:
- Single-agent development (you write both tests and impl directly)
- Quick prototyping or spikes
- Non-adversarial contexts

## Workflow Integration

### M4 START TDD CYCLE
1. **MANDATORY CHECKPOINT**: Call `think_about_task_adherence`
   - Validates: Task alignment before implementation
   - Criteria: Can answer "Am I implementing what was approved?" with evidence-based "Yes"
   - Failure Handling:
     - Misaligned → Stop, refocus, or ask user
     - Aligned → Proceed to step 2 (write tests)

2. **Write failing tests** (RED)

2.5. **THEATER TEST DETECTION** (MANDATORY - BEFORE GREEN)
   - **Core Question**: "Can implementation be WRONG and test still PASS?"
     - If YES → THEATER TEST → REJECT → Return to step 2
     - If NO → GENUINE TEST → Proceed to step 3
   - **Checklist**:
     - [ ] Deterministic problems use EXACT values (not `> 0`, not ranges)
     - [ ] Tests assert MEASURABLE EFFECTS (not just `mock.called`)
     - [ ] No mocking the unit under test itself
     - [ ] Error messages describe BEHAVIOR (WHAT), not implementation (HOW)
   - **Anti-Patterns** (REJECT if found):
     - `assert result is not None` → Tests existence, not correctness
     - `assert result > 0` → Range check for deterministic value
     - `assert mock.called` → Verifies wiring, not behavior
   - **Reference**: ~/.claude/skills/theater-test-detection/

3. **Implement minimal code** (GREEN)

4. **Iteration cycle** (if tests fail)

4.5. **CONSTITUTIONAL AUDIT** (MANDATORY - AFTER GREEN, BEFORE COMMIT)
   - **AI Panel Critique** (MANDATORY - do NOT skip):
     - Tool: `critique_code` with `enable_conversation=true`
     - Submit: ACTUAL code (`git diff --staged`), not summaries
     - review_focus: "Test quality, theater test detection, measurable assertions"
   - **Theater Test Re-Check**: Apply step 2.5 criteria to ALL tests
     - If ANY theater test → REJECT → Return to step 2.5
   - **Quality Gates**:
     - [ ] All tests assert measurable effects
     - [ ] No mocks without verified interactions
     - [ ] Deterministic values are exact
     - [ ] AI Panel critique addressed
   - **Evidence Required**: AI Panel conversation_id, critique summary

5. **Commit with verbose message** (WHY and EXPECTED format per commit standards)
6. **Refactor while green** (REFACTOR)
7. **AI PANEL review** (MANDATORY per CL5); apply all suggestions

### M5 FINAL VALIDATION
1. Run full suite + linters + DRY/SoC/FP gates
2. Record evidence (coverage %, passing tests, git hash)
3. **MANDATORY CHECKPOINT**: Call `think_about_whether_you_are_done`
   - Validates: Completion gates before claiming done per CL2
   - Criteria: Tests pass, AI Panel reviewed, evidence recorded, memory updated, user approval
   - Failure Handling:
     - Incomplete → Address gaps
     - Complete → Proceed to evidence recording

## Evidence Format (Canonical)

Use canonical compressed evidence format:

```
EVIDENCE:
F:path/to/test.ext:lines T:module::test_name=STATUS C:hash COV:X% O:output

Example:
F:tests/test_auth.py:15-42 T:auth::test_jwt_validation=PASS C:a3f2c1b COV:92% O:"All 12 tests passed"
```

## Anti-Patterns (Constitutional Violations)

❌ **Writing implementation before tests** → Violates CL6, STOP immediately
❌ **Skipping RED phase** → Violates CL6, STOP immediately
❌ **THEATER TESTS** → CONSTITUTIONAL VIOLATION, STOP immediately:
   - Tests that assert nothing meaningful (existence checks, range checks for deterministic values)
   - Tests that only verify mocks were called without checking effects
   - Tests where implementation can be WRONG and test still PASSES
   - Mocking the unit under test itself
   - Range assertions (`> 0`) for deterministic problems that have exact answers
❌ **Skipping THEATER TEST DETECTION (M4.2.5)** → Violates QS1, STOP immediately
❌ **Skipping CONSTITUTIONAL AUDIT (M4.4.5)** → Violates CL5/QS1, STOP immediately
❌ **Committing after refactoring** → Violates CL6, commit GREEN state first
❌ **Changing behavior without new tests** → Violates CL6, write tests for new behavior
❌ **Claiming complete without evidence** → Violates CL2, provide evidence
❌ **Skipping AI Panel review** → Violates CL5, submit for review

## Violation Recovery

When TDD violation detected:
1. **STOP immediately** → Acknowledge violation
2. **Identify law/gate broken** → "I violated CL6 by writing implementation before tests"
3. **Ask**: "Restart with proper constitutional adherence?"
4. **Wait for confirmation** → Resume from last valid checkpoint (M4 or earlier)
5. **Document lesson** → Update Serena memory with what went wrong

## Language-Specific Commands

### Python
- Run tests: `pytest path/to/test.py -v`
- Coverage: `pytest --cov=module --cov-report=term-missing`
- Watch mode: `pytest-watch`

### Rust
- Run tests: `cargo test --lib <module>`
- Coverage: `cargo tarpaulin --out Html`
- Watch mode: `cargo watch -x test`

### Haskell
- Run tests: `stack test <package>:<test-suite>`
- Coverage: `stack test --coverage`
- Watch mode: `stack test --file-watch`

### JavaScript/TypeScript
- Run tests: `npm test` or `jest path/to/test.ts`
- Coverage: `jest --coverage`
- Watch mode: `jest --watch`

## Integration with AI Panel

After GREEN + COMMIT + REFACTOR phases, MANDATORY AI Panel review per CL5:

**Tool**: `critique_code`
**Model**: 'default'
**Enable Conversation**: true
**Processing Mode**: oneshot (routine) or parallel (critical)

**Sections**:
- code_context: "TDD cycle implementation for [feature]"
- code_implementation: <paste code>
- review_focus: "Test coverage adequacy, edge cases, adherence to DRY/SoC/FP, refactoring opportunities"
- quality_standards: ">85% coverage per QS1, all edge cases tested, functional style per QS2, no premature optimization"
- architectural_context: <brief system context>

**Post-Review**: Apply ALL suggestions before claiming completion per CL2

## Success Criteria Checklist

- [ ] Test written before implementation (CL6)
- [ ] Test initially fails with expected error (RED)
- [ ] **THEATER TEST DETECTION passed (M4.2.5)** - Core question answered NO for all tests
- [ ] Deterministic problems use EXACT values (not ranges)
- [ ] Tests assert MEASURABLE EFFECTS (not just mock verification)
- [ ] Minimal implementation makes test pass (GREEN)
- [ ] **CONSTITUTIONAL AUDIT passed (M4.4.5)** - AI Panel critique completed
- [ ] AI Panel conversation_id recorded
- [ ] Commit created with WHY/EXPECTED format (COMMIT)
- [ ] Refactoring improves structure while tests stay green (REFACTOR)
- [ ] Coverage >85% achieved (QS1)
- [ ] Edge cases covered (QS1)
- [ ] AI Panel review completed (CL5)
- [ ] All suggestions implemented (CL2)
- [ ] Evidence documented (canonical format)
- [ ] Human approval obtained if required (CL5)

## Remember

**CL8 EFFICIENCY**: Efficiency = balance(delivery_speed, quality) where quality prevents rework

**Fast+wrong is LESS efficient than slow+right**

**Taking time to do it right SAVES time by preventing rework**

---

*This skill executes constitutional principles CL6 (TDD Enforcement), CL2 (Completion Gates), CL5 (Human Approval), QS1 (TDD/BDD Standards), and workflow macros M4-M5.*

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
