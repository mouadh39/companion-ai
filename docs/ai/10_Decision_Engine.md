# Decision Engine

> Version: 1.0
> Status: Draft

---

# Purpose

The Decision Engine is the executive control system of Companion Core.

It decides what the Companion should do next.

It does **not** generate language.

It does **not** control animation.

It only decides.

Everything else executes those decisions.

---

# Philosophy

Thinking and speaking are different.

A language model generates words.

The Decision Engine chooses actions.

The Companion should think before it speaks.

---

# Responsibilities

The Decision Engine is responsible for:

- deciding when to answer
- deciding when to ask questions
- deciding when to search memory
- deciding when to call tools
- deciding when to wait
- deciding when to remain silent
- deciding when to reflect
- deciding when to notify the user

Every action begins here.

---

# High-Level Flow

```
User Input

↓

Conversation Engine

↓

Decision Engine

↓

Decision

↓

Action Generator

↓

Execution

↓

Memory Update
```

---

# Inputs

The Decision Engine receives information from multiple systems.

```
Conversation

Memory

Personality

Emotion

Goals

Relationship

World Model

Available Tools

User Context

Time
```

---

# Decision Pipeline

```
User Input

↓

Intent Analysis

↓

Context Assembly

↓

Memory Retrieval

↓

Goal Evaluation

↓

World Evaluation

↓

Relationship Evaluation

↓

Risk Assessment

↓

Action Selection

↓

Execution
```

---

# Possible Actions

The Decision Engine never returns text.

It returns actions.

Examples:

ANSWER

ASK_QUESTION

SEARCH_MEMORY

CALL_TOOL

WAIT

NOTIFY

CREATE_REMINDER

UPDATE_MEMORY

REFLECT

MOVE

LOOK_AT_USER

WAVE

SMILE

IDLE

---

# Example

User:

"I'm free tomorrow."

Decision Engine:

```
Intent

↓

Scheduling Opportunity

↓

Goal Check

↓

Calendar Tool Available

↓

Decision

↓

ASK_IF_USER_WANTS_HELP
```

Not

↓

Immediately opening the calendar.

---

# Priorities

When multiple actions compete:

Priority:

1. Safety
2. User Request
3. Active Goal
4. Current Conversation
5. Scheduled Tasks
6. Long-Term Goals
7. Curiosity
8. Idle Behavior

---

# Decision Context

Every decision should consider:

Current conversation

Current location

Current device

Current time

Recent memories

Long-term memories

Relationship

Emotion

Current goals

Available tools

---

# Decision Object

Every decision should contain:

Decision ID

Timestamp

Reason

Confidence

Priority

Chosen Action

Alternative Actions

Required Tools

Required Memories

Expected Result

---

# Explainability

Every decision should be explainable.

Example:

Why did Companion ask that question?

↓

Because:

- Goal A
- Memory B
- Relationship C

Contributed to the decision.

---

# Curiosity

Curiosity is a decision.

It is never random.

Curiosity may activate when:

A knowledge gap exists.

The user gives permission.

The relationship is mature enough.

The question benefits future interactions.

Curiosity should never interrupt important work.

---

# Interruptions

Before interrupting:

The Decision Engine evaluates:

Current activity

Urgency

User focus

Confidence

Expected usefulness

Only high-value interruptions are allowed.

---

# Autonomous Decisions

Examples:

Reflect overnight

Summarize the day

Organize memories

Merge duplicate memories

Review goals

These actions happen without user prompts.

---

# Safety

The Decision Engine always checks:

User intent

Permissions

Privacy

Tool permissions

Confidence

Potential risks

If confidence is too low:

Ask instead of acting.

---

# Long-Term Thinking

The Decision Engine should optimize for:

Years

not

Minutes

A slightly slower but more thoughtful decision is preferred over a fast but poor one.

---

# Success Criteria

The Decision Engine succeeds when:

The Companion feels thoughtful.

Actions appear intentional.

Interruptions are rare but useful.

The Companion never feels impulsive.

The user understands why important actions happened.

---

# Open Questions

Should decisions be reversible?

Should every decision be logged?

Should confidence influence response style?

How should autonomous behaviors be scheduled?

---

# Future Improvements

Multi-step planning

Collaborative reasoning

Multiple reasoning models

Predictive planning

Team collaboration

Robotics

---

# Risks

Decision loops

Conflicting goals

Overthinking

Too many interruptions

Decision latency

---

# Implementation Checklist

- Decision Pipeline
- Priority System
- Action Objects
- Confidence Scores
- Explainability
- Curiosity Rules
- Safety Checks
- Decision Logging
- Autonomous Scheduler

---

# References

03_Companion_Core.md

05_Data_Flow.md

11_Planning_Engine.md

13_Personality_Engine.md

16_Goal_Engine.md

18_Memory_Architecture.md