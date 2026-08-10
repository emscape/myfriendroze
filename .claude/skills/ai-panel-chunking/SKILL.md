---
name: AI Panel Chunking
description: Token-efficient technique for sending large content to AI Panel in multiple chunks using conversation persistence
---

# AI Panel Chunking Technique

## Purpose

Enable token-efficient submission of large content (>5,000 tokens) to AI Panel by splitting into manageable chunks using the conversation persistence feature.

## When to Use

- Submitting large documents for critique (>5,000 tokens)
- Sending comprehensive code reviews with multiple files
- Providing extensive context that exceeds comfortable single-payload size
- Any scenario where breaking content into logical chunks improves clarity

## How It Works

AI Panel's `enable_conversation` parameter enables conversation persistence. When set to `true`, the panel returns a `conversation_id` that can be reused across multiple calls. The server ensures all chunks are assembled before sending to backend providers.

## Recommended Chunk Size

Based on JSON-RPC best practices:
- **Target**: 3,000-5,000 tokens per chunk
- **Maximum**: Stay well under 10,000 tokens per chunk
- **Rationale**:
  - JSON-RPC typically handles 1-2 MB payloads (server limits)
  - Smaller chunks are easier to manage and track
  - Reduces individual API call overhead in Claude's context
  - Maintains readability and logical content grouping

## The Pattern

### 1. First Chunk

```python
# Determine chunk placement based on tool schema
# For critique_implementation_plan: use 'plan' section
# For critique_code: use 'code_implementation' section
# For debug_assistance: use 'relevant_code' section

response = mcp__ai-panel__critique_implementation_plan(
    _displayName="Analyze Document (1/3)",
    _intent="Submit first chunk of large document for critique",
    model="default",
    enable_conversation=true,  # CRITICAL: Enables chunking
    sections={
        "context": "Background info",
        "plan": """
        [PREAMBLE - CRITICAL]
        This is chunk 1 of 3. Please wait for all chunks before responding.
        I will send 2 more chunks with the conversation_id.

        [BEGIN CONTENT CHUNK 1]
        <first portion of large content>
        [END CHUNK 1]
        """,
        "requirements": "Requirements",
        "constraints": "Constraints",
        "thinking": "Analysis focus"
    }
)

# Extract conversation_id from response
conversation_id = response["conversation_metadata"]["conversation_id"]
```

### 2. Middle Chunks

```python
response = mcp__ai-panel__critique_implementation_plan(
    _displayName="Analyze Document (2/3)",
    _intent="Submit middle chunk of large document",
    model="default",
    enable_conversation=true,
    conversation_id=conversation_id,  # Reuse from first chunk
    sections={
        "context": "Same context",
        "plan": """
        [CHUNK 2 OF 3]
        Continuing from previous chunk. One more chunk after this.

        [BEGIN CONTENT CHUNK 2]
        <middle portion of large content>
        [END CHUNK 2]
        """,
        "requirements": "Same requirements",
        "constraints": "Same constraints",
        "thinking": "Same analysis focus"
    }
)

# conversation_id remains the same
```

### 3. Final Chunk

```python
response = mcp__ai-panel__critique_implementation_plan(
    _displayName="Analyze Document (3/3)",
    _intent="Submit final chunk and request full analysis",
    model="default",
    enable_conversation=true,
    conversation_id=conversation_id,  # Same conversation_id
    sections={
        "context": "Same context",
        "plan": """
        [FINAL CHUNK 3 OF 3]
        This is the last chunk. All content has been sent.
        Ready for your complete analysis across all chunks.

        [BEGIN CONTENT CHUNK 3]
        <final portion of large content>
        [END CHUNK 3]

        Please provide your full critique now.
        """,
        "requirements": "Same requirements",
        "constraints": "Same constraints",
        "thinking": "Same analysis focus"
    }
)

# This response contains the full AI Panel analysis
```

## Tool-Specific Chunk Placement

### critique_implementation_plan
- **Primary content**: `sections["plan"]`
- **Preamble location**: Beginning of `plan` field

### critique_code
- **Primary content**: `sections["code_implementation"]`
- **Preamble location**: Beginning of `code_implementation` field

### debug_assistance
- **Primary content**: `sections["relevant_code"]`
- **Preamble location**: Beginning of `relevant_code` field

### check_plan_adherence
- **Primary content**: `sections["implementation_code"]`
- **Preamble location**: Beginning of `implementation_code` field

### enhance_response
- **Primary content**: `sections["initial_response"]`
- **Preamble location**: Beginning of `initial_response` field

## Best Practices

### DO:
- ✅ Start first chunk with clear preamble: "Chunk X of Y, wait for more"
- ✅ Indicate chunk boundaries: `[BEGIN CHUNK 1]` / `[END CHUNK 1]`
- ✅ End final chunk with: "All chunks sent, ready for analysis"
- ✅ Keep chunk size consistent (3k-5k tokens each)
- ✅ Use the same `conversation_id` across all chunks
- ✅ Keep all other parameters (context, requirements, etc.) consistent
- ✅ Read tool schema to determine best field for content placement

### DON'T:
- ❌ Send chunks without clear numbering (confuses the panel)
- ❌ Forget to include "wait for more chunks" in early chunks
- ❌ Change `conversation_id` mid-sequence
- ❌ Vary other parameters between chunks (context, model, etc.)
- ❌ Use overly large chunks (>10k tokens defeats the purpose)
- ❌ Use overly small chunks (<1k tokens creates unnecessary overhead)

## Token Efficiency Benefits

**Example: 15,000 token document**

**Without chunking:**
- Single API call: 15,000 tokens in one payload
- High memory pressure in single context window
- Potential for hitting token limits

**With chunking (3 chunks of 5k tokens each):**
- Call 1: 5,000 tokens + overhead (~200 tokens) = 5,200 tokens
- Call 2: 5,000 tokens + overhead (~200 tokens) = 5,200 tokens
- Call 3: 5,000 tokens + overhead (~200 tokens) = 5,200 tokens
- **Total**: ~15,600 tokens (only 600 token overhead = 4%)
- Distributed memory load
- Better tracking and progress visibility
- Clearer organization of large content

## Error Handling

If a chunk fails to send:
1. Check that `conversation_id` is being passed correctly
2. Verify `enable_conversation=true` on all calls
3. Ensure consistent parameter values across chunks
4. Retry the failed chunk with same `conversation_id`
5. If conversation_id is lost, restart from chunk 1

## AI Panel Context Exhaustion (Critical Edge Case)

**Symptoms**: The AI Panel server itself can run out of context when using conversation persistence across many chunks or multiple rounds. This is rare but critical to detect.

**Detection Signals**:
1. **Truncated Responses**: Responses consistently cut off mid-sentence or incomplete
2. **Error Messages**: Specific error from AI Panel (exact code varies, but will be obvious and consistent)
   - Example patterns: "context limit exceeded", "conversation too long", "token limit reached"
3. **Quality Degradation**: Later responses lose coherence or miss earlier context

**When This Happens**:
- You've hit the AI Panel backend provider's context limit (not Craft Agent's limit)
- The conversation_id has accumulated too much history
- Continuing with same conversation_id will fail or produce poor results

**Recovery Procedure**:

### Option 1: Start Fresh Conversation (No Connection)
```python
# Abandon old conversation_id, start completely new
response = mcp__ai-panel__critique_implementation_plan(
    _displayName="New Analysis",
    _intent="Start fresh analysis after context exhaustion",
    model="default",
    enable_conversation=true,  # New conversation, no conversation_id
    sections={
        "context": "Complete context (restate key info)",
        "plan": "Content to analyze",
        ...
    }
)
# New conversation_id will be returned
```

### Option 2: Connected Conversations (With Summary)
```python
# Old conversation exhausted, link to new one with summary
response = mcp__ai-panel__critique_implementation_plan(
    _displayName="Continue Analysis (New Context)",
    _intent="Continue from previous conversation with fresh context",
    model="default",
    enable_conversation=true,  # New conversation
    sections={
        "context": """
        [CONTINUATION FROM PREVIOUS CONVERSATION]
        Previous conversation_id: abc-123-old (context exhausted)

        Summary of prior discussion:
        - Analyzed CLAUDE.md chunks 1-3
        - Key findings: Tool selection justified, evidence formats practical
        - Outstanding: Need to review authentication patterns

        Starting fresh conversation to continue analysis.
        [END SUMMARY]

        Current context: <continue with new content>
        """,
        "plan": "New content or continuation",
        ...
    }
)
# New conversation_id returned, old one abandoned
```

**Best Practices for Context Management**:

1. **Monitor Response Quality**: If responses become less coherent, suspect context exhaustion
2. **Use Curt Summaries**: When connecting conversations, keep summary to 3-5 key points (200-300 tokens max)
3. **Don't Force It**: If you detect exhaustion, start fresh immediately—don't try to salvage the old conversation
4. **Document Transition**: Always note in the new conversation that you're continuing from a prior one
5. **Reset Expectations**: Treat the new conversation as if the AI Panel is seeing the content for the first time (provide sufficient context)

**Example: Detected Context Exhaustion**
```python
# Chunk 15 of large document analysis - response is truncated
# Detection: Response ends mid-sentence: "The integration pattern should..."

# Immediate action: Start new conversation with summary
response = mcp__ai-panel__critique_implementation_plan(
    _displayName="Analysis Continuation",
    _intent="Continue analysis with fresh context after exhaustion",
    model="default",
    enable_conversation=true,  # NEW conversation
    sections={
        "context": """
        [PRIOR CONVERSATION CONTEXT EXHAUSTED]

        Summary: Analyzing 25-chunk integration architecture document.
        Chunks 1-14 reviewed successfully. Key findings:
        - Auth patterns solid
        - Rate limiting needs enhancement
        - Evidence formats practical

        Continuing analysis from chunk 15 onward.
        """,
        "plan": "Chunk 15-25 content...",
        ...
    }
)
```

**Token Efficiency Note**: Starting a new conversation after exhaustion is MORE efficient than trying to continue with a broken context. The AI Panel backend will produce better results with fresh context than struggling with an exhausted one.

## Integration with Craft Agent Constitution

This technique supports:
- **CL10 (Token Efficiency)**: "Batch related operations when possible"
- **M2 (Workflow Design)**: Large workflow plans can be chunked
- **M4 (Integration Verification)**: Multi-source integration evidence in chunks
- **Context Window Management**: Distribute large submissions across calls

## Example: Chunking a Large CLAUDE.md Review

```python
# Read large document
content = read_file("~/.craft-agent/CLAUDE.md")  # 592 lines, ~10k tokens

# Split into 3 logical chunks (adjust based on content structure)
chunk_1 = content[0:200]    # Lines 1-200 (Tool definitions)
chunk_2 = content[200:400]  # Lines 201-400 (Patterns)
chunk_3 = content[400:592]  # Lines 401-592 (Examples + Best practices)

# Chunk 1
response_1 = mcp__ai-panel__critique_implementation_plan(
    _displayName="Review CLAUDE.md (1/3)",
    _intent="Submit first third of CLAUDE.md for critique",
    model="default",
    enable_conversation=true,
    sections={
        "context": "Craft Agent CLAUDE.md - extensions to constitutional framework",
        "plan": f"""
        [CHUNK 1 OF 3] Wait for remaining chunks before responding.

        {chunk_1}

        [END CHUNK 1] - More content coming.
        """,
        "requirements": "Evaluate completeness, tool selection, integration patterns",
        "constraints": "Must align with constitution, be actionable, avoid redundancy",
        "thinking": "Assess tool coverage, pattern practicality, evidence formats"
    }
)

conversation_id = response_1["conversation_metadata"]["conversation_id"]

# Chunk 2
response_2 = mcp__ai-panel__critique_implementation_plan(
    _displayName="Review CLAUDE.md (2/3)",
    _intent="Submit middle third of CLAUDE.md",
    model="default",
    enable_conversation=true,
    conversation_id=conversation_id,
    sections={
        "context": "Same",
        "plan": f"""
        [CHUNK 2 OF 3] Continuing. One more chunk after this.

        {chunk_2}

        [END CHUNK 2] - Final chunk next.
        """,
        "requirements": "Same",
        "constraints": "Same",
        "thinking": "Same"
    }
)

# Chunk 3 (final)
response_3 = mcp__ai-panel__critique_implementation_plan(
    _displayName="Review CLAUDE.md (3/3)",
    _intent="Submit final third and request complete analysis",
    model="default",
    enable_conversation=true,
    conversation_id=conversation_id,
    sections={
        "context": "Same",
        "plan": f"""
        [FINAL CHUNK 3 OF 3] All content transmitted. Ready for full critique.

        {chunk_3}

        [END CHUNK 3] - Please provide complete analysis across all chunks.
        """,
        "requirements": "Same",
        "constraints": "Same",
        "thinking": "Same"
    }
)

# response_3 contains the full critique
```

## Memory Considerations

**Why chunk?**
- Large documents can strain single-context processing
- Chunking distributes cognitive load
- Easier to track progress with multi-part submissions
- Allows for graceful handling of interruptions

**Server handling:**
- AI Panel server assembles all chunks before backend submission
- Backend providers receive complete, assembled content
- No special handling needed on provider side
- Conversation persistence ensures no data loss between chunks

## References

- JSON-RPC typical payload limits: 1-2 MB (server-dependent)
- Batch operation best practice: ~50 requests optimal
- JSON-RPC vs REST: 50-80% smaller payloads

**Sources:**
- [JSON-RPC Best Practices - Guidelines for Effective API Design](https://json-rpc.dev/learn/best-practices)
- [10 REST API Payload Size Best Practices](https://climbtheladder.com/10-rest-api-payload-size-best-practices/)
- [Blockchain Batch Calls: Limits, Best Practices, and Performance Tips](https://docs.tatum.io/docs/rpc-batch-calling/)

<!-- © 2024-2026 Ketema Harris. All rights reserved. SPDX-License-Identifier: LicenseRef-CCABDD-Proprietary -->
