# Companion Core

> Version: 1.0
> Status: Draft

---

# Purpose

Companion Core is the central intelligence of Companion AI.

It is responsible for every cognitive function of the companion, including:

- Conversation
- Memory
- Personality
- Planning
- Decision Making
- Reflection
- Goals
- Relationships
- World Understanding
- Tool Usage

Companion Core is completely independent of Unity, AR Foundation, or any specific client application.

---

# Design Goals

The Companion Core must:

- remain platform independent
- support multiple client applications
- survive LLM upgrades
- maintain a persistent identity
- continuously learn
- remain modular
- be highly testable
- support autonomous behaviors
- scale over years of user interaction

---

# High-Level Architecture

```
                           Companion Core
                                   │
        ┌───────────────┬──────────┴──────────┬───────────────┐
        │               │                     │               │
 Conversation      Memory Engine      Personality      World Model
        │               │                     │               │
        └───────────────┼──────────────┬──────┘
                        │              │
                 Decision Engine   Planning Engine
                        │
                  Action Generator
                        │
                   Tool Manager
                        │
                External Services
```

---

# Core Components

## Conversation Engine

Responsible for:

- understanding user messages
- maintaining dialogue
- conversation context
- response generation
- conversation history

Owns:

- active conversation
- temporary context

Never stores long-term memory.

---

## Memory Engine

Responsible for:

- memory retrieval
- memory storage
- memory ranking
- memory consolidation
- forgetting
- summarization

Owns:

- episodic memory
- semantic memory
- procedural memory
- relationship memory

---

## Personality Engine

Responsible for:

- communication style
- humor
- curiosity
- confidence
- empathy
- consistency

The Personality Engine should influence every response but never replace reasoning.

---

## Emotion Engine

Responsible for interpreting emotional context.

Examples:

- frustration
- excitement
- confidence
- uncertainty
- stress
- happiness

Emotion affects planning and conversation but does not directly control decisions.

---

## Relationship Engine

Tracks the relationship between Companion and the user.

Examples:

- trust
- familiarity
- shared experiences
- communication preferences
- interaction history

Relationship changes gradually over time.

---

## Planning Engine

Responsible for long-term thinking.

Examples:

- project planning
- reminders
- task sequencing
- scheduling
- autonomous suggestions

Planning should consider:

- user goals
- deadlines
- previous work
- available tools

---

## Decision Engine

The brain of Companion Core.

Every action passes through the Decision Engine.

Examples:

Should I answer?

Should I ask a question?

Should I search memory?

Should I call a tool?

Should I remain silent?

Should I create a reminder?

Should I notify the user?

The Decision Engine never generates language.

It decides what should happen.

---

## Reflection Engine

Runs in the background.

Purpose:

Transform experiences into knowledge.

Examples:

Today's conversations

↓

Interesting patterns

↓

Useful long-term memories

↓

Behavior improvements

Reflection should happen periodically and should not interrupt the user.

---

## World Model

Stores everything Companion knows about the environment.

Future examples:

Room layout

Furniture

Objects

Devices

User location

Frequently used places

The World Model is separate from Unity.

Unity observes the world.

Companion Core understands it.

---

## Goal Engine

Tracks:

Short-term goals

Long-term goals

Completed goals

Abandoned goals

Priority

Dependencies

Goals influence planning and memory retrieval.

---

## Tool Manager

Responsible for interacting with external capabilities.

Examples:

Calendar

Email

Browser

Camera

Music

Maps

Weather

Smart Home

Future tools can be added without changing Companion Core.

---

# Information Flow

```
User

↓

Conversation

↓

Decision Engine

↓

Memory Retrieval

↓

Planning

↓

Personality

↓

Emotion

↓

Tool Selection

↓

Reasoning Model

↓

Response

↓

Memory Update

↓

Reflection Queue
```

---

# Why the LLM is not the Core

The language model is a reasoning component.

It should never own:

- memories
- personality
- goals
- relationships
- planning

This allows Companion AI to remain consistent even when switching from one model provider to another.

---

# Platform Independence

Companion Core should support:

- Unity
- Android
- iOS
- Desktop
- Web
- Quest
- AR Glasses
- Robotics

without changing its architecture.

---

# Responsibilities

Companion Core owns:

✅ Memory

✅ Planning

✅ Personality

✅ Reflection

✅ Relationships

✅ Decisions

✅ Context

✅ Goals

Companion Core does NOT own:

❌ Rendering

❌ Animation

❌ AR Tracking

❌ Voice Playback

❌ Camera Rendering

Those belong to the client application.

---

# Success Criteria

Companion Core is successful if:

- replacing Unity requires no AI changes
- replacing the LLM requires no personality changes
- memories remain consistent across years
- new tools can be added without redesigning the system
- every subsystem has a clear responsibility
- no subsystem depends on Unity-specific code   