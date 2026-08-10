# Skill: playability-validator

## Purpose
Validate that a user can complete an intended interactive flow from start to finish, without getting stuck or encountering broken states. Generic — applies to any interactive system (games, multi-step forms, wizards, workflows, onboarding flows, etc.).

This is distinct from unit tests (which test logic in isolation) and from integration-guard (which tests wiring). The playability validator asks: **can a user actually complete this?**

## When to Use
- After implementing a new user flow or interactive feature
- When a tester reports they are stuck or cannot progress
- Before shipping any feature with sequential steps or unlock conditions
- After modifying progression logic, state machines, or unlock conditions

## Inputs Required
- `flow_name`: name of the flow to validate (e.g., `checkout`, `onboarding`, `case-investigation`)
- `start_state`: the initial condition a user starts in
- `success_condition`: what a completed flow looks like
- `steps`: list of steps or decision points in the flow (optional — will be derived if omitted)

## Output Expectations
A playability report:

### 1. Flow Trace
Walk the happy path from start_state to success_condition:
- Each step with expected inputs and outputs
- Whether each transition is possible with available inputs

### 2. Blocking Paths
Identify any state from which the user cannot reach success_condition:
- Dead ends: states with no forward transitions
- Softlocks: circular paths that never reach the goal
- Missing prerequisites: required inputs that are never made available

### 3. Edge Cases
- What happens if the user skips an optional step?
- What happens if required data is missing or malformed?
- What is the first state where failure is recoverable vs permanent?

### 4. Coverage Check
- Is there a test that exercises the happy path end-to-end?
- Is there a test for each identified blocking path?
- Are recovery paths (retry, go back, cancel) tested?

### 5. Verdict
- PLAYABLE: flow is completable, no blockers found
- SOFTLOCK RISK: identified paths that may trap users — list them
- BROKEN: happy path is not completable — must fix before shipping

## Constraints
- This skill validates completability — not aesthetics, performance, or code quality
- A flow is broken if ANY required prerequisite is unreachable from the start state
- Do not approve flows where the success condition can never be reached
- Missing tests for blocking paths must be flagged as BLOCKER, not warning

## Example Invocation
```
/playability-validator flow_name=case-001-investigation start_state="case opened, no evidence linked" success_condition="all puzzles solved"
/playability-validator flow_name=document-link flow_name=evidence-linking start_state="two documents visible" success_condition="evidence link created and persisted"
/playability-validator flow_name=unlock-gate start_state="required evidence exists in case" success_condition="puzzle marked as unlocked"
```

## Common Failure Modes This Prevents
- Shipping a flow with a dead-end state reachable under normal use
- Unlock conditions that require evidence that is never presented to the user
- Required steps that are gated behind incomplete features
- Flows that work in tests but break when real user data is used
- Multi-step processes where going "back" corrupts forward state
