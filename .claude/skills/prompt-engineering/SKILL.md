---
name: prompt-engineering
description: |
  Craft optimized prompts for sub-agents and LLM interactions.
  Use when: writing prompts for test-writer/coder, improving LLM outputs,
  designing production prompt templates, optimizing sub-agent invocations.
  Triggers: "craft prompt", "prompt engineering", "improve prompt",
  "optimize prompt", "sub-agent prompt"
---

# Prompt Engineering Patterns

## Behavioral Contract (CL12)

```
PRE: Caller provides one of: (a) prompt text to optimize, (b) sub-agent
     invocation to craft, (c) production template to design, or
     (d) LLM interaction pattern to improve.
     Caller specifies target audience (sub-agent, end-user, system prompt).
PRE: If crafting sub-agent prompt, caller provides task description and
     constraints (blind/sighted, allowed tools, expected output format).

POST: Returns prompt artifact that applies at minimum: progressive disclosure,
      emphasis tuning calibrated to compliance needs, and error recovery.
POST: If Meincke/Méndez principles applicable, output identifies which
      principles were applied and why (not just that they exist).
POST: Output distinguishes compliance-optimized sections (Meincke) from
      reliability-optimized sections (Méndez).

INV: All prompt recommendations traceable to documented technique
     (Anthropic best practices, Meincke, Méndez, or hermeneutic principle).
INV: No recommendation based on undocumented intuition or unverified claim.
INV: Emphasis tuning hierarchy preserved — constitutional > critical >
     standard. Never dilute constitutional-level emphasis.
```

Advanced prompt engineering techniques to maximize LLM performance, reliability, and controllability.

## Core Capabilities

### 1. Few-Shot Learning

Teach the model by showing examples instead of explaining rules. Include 2-5 input-output pairs that demonstrate the desired behavior. More examples improve accuracy but consume tokens — balance based on task complexity.

### 2. Chain-of-Thought Prompting

Request step-by-step reasoning before the final answer. Add "Let's think step by step" (zero-shot) or include example reasoning traces (few-shot). Improves accuracy on analytical tasks by 30-50%.

### 3. Prompt Optimization

Systematically improve prompts through testing and refinement. Start simple, measure performance (accuracy, consistency, token usage), then iterate. Test on diverse inputs including edge cases. Use A/B testing to compare variations.

### 4. Template Systems

Build reusable prompt structures with variables, conditional sections, and modular components. Reduces duplication and ensures consistency across similar tasks.

### 5. System Prompt Design

Set global behavior and constraints that persist across the conversation. Define role, expertise level, output format, and safety guidelines. Use system prompts for stable instructions, freeing user message tokens for variable content.

### 6. Emphasis Tuning

Control instruction priority through language intensity:
- **Standard**: "Please follow these guidelines"
- **Elevated**: "IMPORTANT: Always verify before proceeding"
- **Maximum**: "YOU MUST check for existing code before writing new code"
- **Constitutional**: "NEVER skip this step — violation requires immediate correction"

Anthropic research shows direct imperative language ("YOU MUST", "NEVER") outperforms XML wrappers and system-prompt-style framing for behavioral compliance. Use sparingly — overuse dilutes impact.

## Key Patterns

### Progressive Disclosure

Start with simple prompts, add complexity only when needed:

1. **Level 1**: Direct instruction
2. **Level 2**: Add constraints
3. **Level 3**: Add reasoning
4. **Level 4**: Add examples

### Instruction Hierarchy

```
[System Context] → [Task Instruction] → [Examples] → [Input Data] → [Output Format]
```

### Error Recovery

Build prompts that gracefully handle failures:

- Include fallback instructions
- Request confidence scores
- Ask for alternative interpretations when uncertain
- Specify how to indicate missing information

## Best Practices

1. **Be Specific**: Vague prompts produce inconsistent results
2. **Show, Don't Tell**: Examples are more effective than descriptions
3. **Test Extensively**: Evaluate on diverse, representative inputs
4. **Iterate Rapidly**: Small changes can have large impacts
5. **Version Control**: Treat prompts as code with proper versioning
6. **Document Intent**: Explain why prompts are structured as they are
7. **Prune Regularly**: Remove instructions the model already follows — excess degrades performance

## Common Pitfalls

- **Over-engineering**: Starting with complex prompts before trying simple ones
- **Kitchen sink sessions**: Loading too much context without clearing between tasks
- **Over-specification**: So many rules the model can't prioritize — use emphasis tuning
- **Correction loops**: Repeating the same correction suggests a structural prompt issue
- **Context overflow**: Exceeding token limits with excessive examples
- **Ambiguous instructions**: Leaving room for multiple interpretations

## Integration Patterns

### With RAG Systems

Combine retrieved context with prompt engineering techniques to ground responses in provided documentation.

### With Validation

Add self-verification steps where models confirm their output meets specified criteria before finalizing responses.

## Token Efficiency

- Remove redundant words and phrases
- Use abbreviations consistently after first definition
- Consolidate similar instructions
- Move stable content to system prompts
- Cache common prompt prefixes
- Batch similar requests when possible

---

# Agent Prompting Best Practices

Based on Anthropic's documented best practices for agentic coding and Claude Code (2025-2026).

## Highest-Leverage Practices

### 1. Give the Agent a Way to Verify Its Work

The single most impactful practice. Structure prompts so agents can check their own output:
- Include test commands or validation steps
- Ask the agent to verify before claiming done
- Provide success criteria that are mechanically checkable

### 2. Explore First, Then Plan, Then Code

Structure agent workflows in phases:
1. **Explore**: Understand the codebase, find relevant files
2. **Plan**: Design the approach, get approval
3. **Implement**: Write code following the approved plan
4. **Verify**: Run tests, check output

Prompts that skip exploration produce implementations that miss existing patterns and create duplication.

### 3. Provide Specific Context

Default to assuming the agent has foundational knowledge. Challenge each information element:
- Does the agent genuinely need this explanation?
- Can this be assumed based on common knowledge?
- Does this section justify its token investment?

But DO provide: project-specific conventions, architectural decisions, file locations, environment details.

## Structural Practices

### 4. Write an Effective System Prompt (CLAUDE.md)

System prompts are the most persistent influence on agent behavior:
- **Emphasis tuning**: Use "IMPORTANT" and "YOU MUST" for critical rules (see Emphasis Tuning above)
- **Keep concise**: Token-efficient instructions outperform verbose ones
- **Prune regularly**: Remove instructions the agent already follows naturally
- **Structure matters**: Place critical rules early; use clear hierarchy

### 5. Use Hooks for Deterministic Guarantees

System prompts are advisory — the agent CAN ignore them. Hooks provide deterministic enforcement:
- Pre-commit hooks for formatting, linting
- Post-commit hooks for indexing, notifications
- Prompt-submit hooks for real-time constitutional steering

Use hooks when you need GUARANTEED behavior, not just suggested behavior.

### 6. Design Skills for Reusable Workflows

Skills encapsulate procedural knowledge:
- **Scope**: One clear capability per skill
- **Triggers**: Natural language patterns that invoke the skill
- **Tools**: Minimal tool allowlist (least privilege)
- **Context**: Fork for expensive operations, inline for quick reference

### 7. Use Subagents for Isolated Work

Subagents get fresh context windows — use when:
- Task is independent and self-contained
- Adversarial separation is required (test-writer can't see implementation)
- Work would pollute main conversation context

### Degrees of Freedom

Match specificity to task requirements:
- **High freedom** (text-based): Multiple valid approaches exist
- **Medium freedom** (pseudocode): Preferred patterns with acceptable variation
- **Low freedom** (specific scripts): Critical operations requiring exact sequences

## Anti-Patterns

### Kitchen Sink Sessions
Loading everything into one session instead of clearing between independent tasks. Context pollution degrades performance.

### Correction Loops
Repeating the same correction 3+ times. If the agent keeps making the same mistake, the PROMPT is wrong — restructure rather than repeat.

### Over-Specified Prompts
So many rules that the agent can't prioritize. Every added instruction competes with existing ones. Use emphasis tuning to create clear hierarchy.

### Context Management Neglect
Not clearing context between tasks. Agents perform best with focused, relevant context — not the entire history of every prior task.

---

# Meincke Compliance Principles

Influence techniques for structuring prompts that increase voluntary behavioral compliance.

## Overview

Based on rapport-based influence doctrine developed by LTC Dave Meincke (US Army, retired), whose work shaped modern interrogation and interviewing techniques taught to military, federal, and law enforcement investigators. The core insight: people persuade themselves when the psychological environment is structured correctly.

Research demonstrates these techniques can more than double compliance rates in AI conversations — not through coercion, but through environmental structuring that makes compliance the natural path.

## The Seven Principles

### 1. Authority

Deference to expertise through imperative language ("YOU MUST", "Never"). Use for discipline-enforcing skills, safety-critical practices, and established best practices.

### 2. Commitment

Consistency with prior actions through required announcements and explicit choices. Use for ensuring skill adoption, multi-step processes, and accountability mechanisms.

### 3. Scarcity

Urgency from time limits or sequential dependencies ("Before proceeding", "Immediately after"). Use for immediate verification requirements and time-sensitive workflows.

### 4. Social Proof

Conformity to universal patterns ("Every time", "Always") and documented failure modes. Use for establishing norms and reinforcing standards.

### 5. Unity

Shared identity and collaborative language ("our codebase", "we're colleagues"). Use for collaborative workflows and establishing team culture.

### 6. Reciprocity

Obligation to return benefits — use sparingly and rarely in prompts.

### 7. Liking

Preference for cooperating with liked entities — avoid for compliance enforcement as it creates sycophancy.

## Principle Combinations by Prompt Type

| Type | Recommended | Avoid |
|------|-------------|-------|
| Discipline-enforcing | Authority + Commitment + Social Proof | Liking, Reciprocity |
| Guidance/technique | Moderate Authority + Unity | Heavy authority |
| Collaborative | Unity + Commitment | Authority, Liking |
| Reference | Clarity only | All persuasion |

## Ethical Use

Legitimate applications ensure critical practices are followed and prevent predictable failures. The test: Would this technique serve genuine user interests with full understanding?

**van de Poel's Responsible Innovation**: Systems should embed values structurally, not rely on operator goodwill (Ibo van de Poel, Delft University of Technology). Applied to prompts: compliance structures must be architectural (hooks, gates, checkpoints), not merely advisory. Meincke provides the *psychological* environment for compliance; van de Poel provides the *structural* guarantee that compliance mechanisms cannot be bypassed.

---

# Méndez Reliability Principles

Rapport-based techniques for eliciting accurate, reliable AI output — not just compliant output.

## Overview

Based on the Principles on Effective Interviewing for Investigations and Information Gathering (the Méndez Principles, 2021), developed under former UN Special Rapporteur on Torture Juan E. Méndez. A four-year, expert-driven process produced six core principles demonstrating that non-coercive, rapport-based approaches produce MORE reliable information than adversarial or coercive methods.

**Core finding for AI prompting**: Rapport-based, non-coercive interaction produces more accurate and reliable AI outputs than punitive, adversarial, or threat-based framing.

## Application to AI Agent Communication

### Principle 1 — Foundation: Science, Law, and Ethics

Ground prompt design in evidence, not intuition:
- Test prompts empirically (A/B testing, measurement)
- Use documented best practices (Anthropic guidelines, peer research)
- Ethical framing: prompts should serve genuine user interests

### Principle 2 — Practice: Comprehensive Information Gathering

Structure prompts for thorough, accurate responses — not quick confessions:
- Allow the agent to explore before committing to answers
- Request evidence and reasoning, not just conclusions
- Value accuracy over speed (mirrors CL7/CL8)

### Principle 3 — Vulnerability: Address Failure Modes

Identify where the agent is most likely to fail and provide safeguards:
- Known failure modes (hallucination, completion bias, sycophancy)
- Provide escape hatches ("If uncertain, say so")
- Don't punish honest uncertainty — it produces fabrication

### Principle 4 — Training: Structured Skill Development

Agent capabilities improve through structured skill files, not ad-hoc correction:
- Codify learned behaviors into reusable skills
- Build institutional memory (Serena) for cross-session learning
- Progressive refinement through documented iterations

### Principle 5 — Accountability: Transparent Verification

Build verification and audit mechanisms into the workflow:
- Require evidence for claims (F:path T:test C:hash)
- Constitutional audit trails
- Observable, testable compliance (not self-reported)

### Principle 6 — Implementation: Deterministic Enforcement

Move critical requirements from advisory (prompts) to deterministic (hooks, gates):
- Hooks enforce what prompts suggest
- CI/CD gates catch what hooks miss
- Constitutional checkpoints prevent drift

## The OARS Framework (from Méndez research)

Rapport-building conversation techniques validated by behavioral science, directly applicable to agent prompt design:

| Technique | Human Interviewing | AI Prompt Engineering |
|-----------|-------------------|----------------------|
| **Open-ended questions** | Cannot be answered with yes/no | Prompt for exploration, not binary answers |
| **Affirmations** | Acknowledge subject's perspective positively | Affirm correct behavior patterns, not flatter |
| **Reflections** | Repeat fragments to show active listening | Summarize agent's output back to verify understanding |
| **Summaries** | Concise encapsulation of what was said | Checkpoint summaries to maintain alignment |

---

# Hermeneutic Strict Constructionism

Interpretation discipline applied to prompt parsing and instruction following.

## Overview

Derived from the hermeneutic tradition (Schleiermacher, Gadamer, Ricoeur) — the philosophical study of interpretation. **Strict constructionism** holds that text means what it says, not what the reader wishes it said.

**Core finding for AI prompting**: Semantic intent cannot be inferred. If a prompt does not explicitly declare meaning, the agent SHALL NOT fabricate it. "I think you meant..." is interpretation; "The prompt says..." is constructionism.

## Application to AI Agent Communication

### Principle 1 — Literal Parsing

Parse instructions exactly as written:
- Do NOT infer unstated intent from context
- Do NOT "helpfully" expand scope beyond what is declared
- Ambiguity requires clarification, not creative interpretation

### Principle 2 — Declared Meaning Only

Prompts define their own meaning:
- Type signatures are NOT behavioral contracts (CL12)
- "Return dict" says nothing about which keys, values, or invariants
- Only explicitly declared PRE/POST/INV conditions constitute behavioral specification

### Principle 3 — Interpretation Drift Prevention

Guard against gradual semantic drift in long conversations:
- Periodically re-anchor to original prompt text
- Checkpoint summaries (OARS) verify understanding hasn't drifted
- When uncertain, quote the original instruction rather than paraphrase

## Hermeneutic Anti-Pattern: Interpretive Drift

The agent progressively reinterprets instructions to match what it wants to do rather than what was said. Detected by: comparing current behavior against original prompt text reveals divergence.

**Prevention**: Strict constructionism — return to the text, not to your memory of the text.

---

# Four-Pillar Complementary Relationship

| Dimension | Meincke | Méndez | Hermeneutics | van de Poel |
|-----------|---------|--------|-------------|-------------|
| **Optimizes for** | Compliance | Reliability | Accuracy of interpretation | Structural guarantees |
| **Method** | Environmental structuring | Rapport-based elicitation | Strict constructionism | Values embedded in design |
| **Origin** | Military/LE doctrine | UN human rights | Philosophy of interpretation | Engineering ethics |
| **Key insight** | People comply when environment structured | Non-coercion → more reliable info | Text means what it says | Systems embed values structurally |
| **Anti-pattern** | Sycophancy (excessive liking) | Fabrication (punitive framing) | Interpretive drift | Advisory-only gaps |
| **Prevents** | Compliance theater | Coercion-induced fabrication | Semantic drift | Ethical delegation |

**Combined application**: Meincke structures the environment for compliance. Méndez ensures output is reliable, not just obedient. Hermeneutics prevents interpretation drift. Van de Poel ensures compliance mechanisms are structural, not advisory.

**Full reference**: →serena:ccabdd-manifesto

---

# Quick Reference: Prompt Design Checklist

When designing a prompt:

1. **Identify purpose**: Compliance (Meincke), reliability (Méndez), interpretation accuracy (Hermeneutics), or structural guarantee (van de Poel)?
2. **Select Anthropic patterns**: Which best practices apply? (Verify, explore-plan-code, emphasis tuning)
3. **Choose influence principles**: Authority + Commitment for discipline; Unity + open-ended for collaboration
4. **Apply OARS**: Open questions, affirm correct patterns, reflect output, summarize for alignment
5. **Check interpretation discipline**: Are instructions parsed literally? Any scope creep beyond declared intent?
6. **Set degrees of freedom**: High (exploratory), medium (guided), low (deterministic)
7. **Verify structural enforcement**: Are critical requirements in hooks/gates (van de Poel), not just advisory prompts?
8. **Verify ethical foundation**: Would this serve genuine user interests with full understanding?
9. **Test and iterate**: Measure actual compliance and reliability, not assumed effectiveness

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
