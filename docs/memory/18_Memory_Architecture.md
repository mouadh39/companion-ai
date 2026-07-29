# Memory Architecture

> Version: 1.0
> Status: Draft

---

# Purpose

The Memory Engine is responsible for storing, retrieving, organizing, consolidating, and forgetting information throughout the lifetime of the Companion.

Memory is the foundation of long-term intelligence.

Without memory, Companion AI is only a chatbot.

With memory, Companion AI becomes a long-term companion.

---

# Design Goals

The Memory Engine must:

- remember meaningful experiences
- forget unimportant information
- learn over time
- retrieve relevant memories quickly
- understand relationships between memories
- support years of conversations
- continuously improve retrieval quality
- remain explainable

---

# Philosophy

Companion AI does **not** have one memory.

It has multiple specialized memory systems.

Each system exists for a different purpose.

---

# High-Level Architecture

```
                    Memory Engine
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   Working Memory    Long-Term Memory   Memory Manager
        │                  │                  │
        │          ┌───────┴────────┐         │
        │          │                │         │
        ▼          ▼                ▼         ▼

 Episodic      Semantic      Procedural   Relationship
  Memory         Memory         Memory        Memory

        │
        ▼

 Knowledge Graph

        │
        ▼

 Retrieval Engine

        │
        ▼

 Conversation
```

---

# Memory Types

## Working Memory

Purpose:

Store everything needed during the current conversation.

Examples:

Current topic

Recent questions

Temporary calculations

Current plan

Current task

Lifetime:

Minutes.

Never permanent.

---

## Episodic Memory

Stores experiences.

Examples:

"Today we tested the AR system."

"Yesterday we finished Phase 1.5."

Episodes are chronological.

They answer:

"What happened?"

---

## Semantic Memory

Stores facts.

Examples:

User lives in Tunisia.

User is building Companion AI.

Companion uses Unity.

Facts are independent of time.

They answer:

"What is true?"

---

## Procedural Memory

Stores how things are done.

Examples:

How to build the Unity project.

How to deploy the backend.

How the user prefers debugging.

Procedural memory represents knowledge about processes.

---

## Relationship Memory

Stores information about the relationship.

Examples:

Trust level

Shared experiences

Communication preferences

Favorite discussion styles

Comfort boundaries

Relationship Memory evolves slowly.

---

# Memory Objects

Every memory should contain:

Unique ID

Memory Type

Timestamp

Importance

Confidence

Source

Related Memories

Summary

Embedding

Tags

---

# Memory Importance

Every memory receives an importance score.

Examples:

Conversation about weather

↓

Importance = Low

Conversation about life goals

↓

Importance = High

Importance influences:

Retention

Retrieval

Reflection

---

# Memory Lifecycle

```
Conversation

↓

Candidate Memory

↓

Importance Scoring

↓

Store

↓

Reflection

↓

Knowledge Graph

↓

Retrieval
```

---

# Forgetting

Companion AI should forget.

Examples:

Temporary questions

Expired tasks

Old context

Duplicate information

Forgetting reduces clutter.

Important memories should survive.

---

# Memory Retrieval

Retrieval should use multiple signals.

Examples:

Semantic similarity

Time

Importance

Current goals

Current emotion

Relationship context

Recent conversations

No single signal should dominate.

---

# Knowledge Graph

Memories should connect.

Example:

Unity

↓

Project

↓

Companion AI

↓

AR

↓

Samsung S22

↓

Testing

Instead of isolated memories, Companion AI builds understanding.

---

# Reflection

Reflection runs in the background.

Purpose:

Convert experiences into knowledge.

Example:

Many conversations

↓

Pattern discovered

↓

Insight created

↓

Future conversations improve

---

# Privacy

The user owns every memory.

The user can:

View

Export

Delete

Correct

Disable

No hidden memories.

---

# Success Criteria

The Memory Engine succeeds if:

The Companion remembers years of conversations.

Retrieval is fast.

Memories remain relevant.

The user trusts the system.

The companion becomes more helpful over time.

The system scales without becoming disorganized.

---

# Open Questions

Should memories decay gradually?

Should memories merge automatically?

Should users pin memories?

Should memories have confidence scores?

How should conflicting memories be handled?

---

# Future Improvements

Visual memories

Voice memories

Location memories

Emotion memories

Shared memories

Dreaming / offline consolidation

---

# Risks

Memory overload

Incorrect retrieval

Privacy concerns

Duplicate memories

Hallucinated memories

---

# Implementation Checklist

- Working Memory
- Episodic Memory
- Semantic Memory
- Procedural Memory
- Relationship Memory
- Memory Ranking
- Memory Search
- Knowledge Graph
- Reflection Pipeline
- Forgetting Strategy

---

# References

03_Companion_Core.md

19_Working_Memory.md

20_Episodic_Memory.md

21_Semantic_Memory.md

22_Procedural_Memory.md

23_Relationship_Memory.md

24_Knowledge_Graph.md

25_Memory_Lifecycle.md