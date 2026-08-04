# Companion AI
### The Companion Core Blueprint

> **Version:** 1.0
> **Status:** In Development
> **Author:** Mourez Labs
> **Project:** Companion AI

---

# Vision

Companion AI is an intelligent, persistent AI companion designed to live alongside the user in their **real environment** through Augmented Reality.

Unlike traditional chatbots, Companion AI is designed to build a long-term relationship with the user by remembering experiences, understanding goals, learning preferences, and becoming increasingly helpful over time.

The project combines:

- Artificial Intelligence
- Long-Term Memory
- Autonomous Planning
- AR Presence
- Voice Interaction
- Personal Knowledge Management

The ultimate goal is not to create another chatbot.

The goal is to create a true digital companion.

---

# Mission

Create an AI that:

- Lives in the user's real world.
- Remembers years of shared experiences.
- Understands goals and routines.
- Assists with everyday life.
- Learns continuously.
- Respects user privacy.
- Evolves without losing its identity.

---

# Design Philosophy

Companion AI is built around one fundamental belief:

> **The intelligence is not the language model.**

The language model is only one component.

The real intelligence comes from:

- Memory
- Personality
- Planning
- Reflection
- Relationship
- Decision Making
- World Understanding

Because of this, Companion AI should continue to feel like the same companion even if the underlying language model changes.

---

# High-Level Architecture

```
                    Companion Core
                           │
 ┌─────────────────────────┼──────────────────────────┐
 │                         │                          │
Conversation           Memory Engine          World Model
 │                         │                          │
Emotion Engine      Personality Engine      User Context
 │                         │                          │
 └──────────────┬──────────┴───────────────┬──────────┘
                │                          │
          Decision Engine          Planning Engine
                │
          Action Generator
                │
           Tool Manager
                │
     ┌──────────┼──────────┐
     │          │          │
 Unity AR   Mobile App   Desktop
```

---

# Project Structure

```
docs/
```

Documentation is divided into multiple sections.

## Foundation

- Vision
- Philosophy
- Core Principles

---

## Architecture

Defines every major subsystem.

Examples:

- Companion Core
- Backend
- API
- Event System
- Data Flow

---

## AI

Defines how Companion AI thinks.

Includes:

- Conversation
- Personality
- Decision Making
- Reflection
- Planning
- Goals
- Relationships

---

## Memory

Defines every memory system.

Examples:

- Working Memory
- Episodic Memory
- Semantic Memory
- Procedural Memory
- Relationship Memory
- Knowledge Graph

---

## World

Defines everything Companion AI knows about:

- Environment
- Objects
- Spaces
- Devices
- User Context

---

## Unity

Defines the Unity client.

The Unity project is intentionally separate from Companion Core.

Unity is responsible only for:

- Rendering
- Animation
- Voice Playback
- AR
- Interaction

Unity does **not** contain the intelligence.

---

## Backend

Defines:

- Database
- APIs
- Vector Search
- Background Workers
- LLM Providers

---

## Future

Research documents.

Examples:

- Quest
- AR Glasses
- Robotics
- Future AI capabilities

---

# Core Principles

The project follows these rules:

1. The AI lives in the user's real world.
2. Unity is only a client.
3. Companion Core owns the intelligence.
4. Memory belongs to the user.
5. The language model is replaceable.
6. Every subsystem has a single responsibility.
7. Decisions should be explainable.
8. Architecture should remain modular.
9. Long-term consistency is more important than short-term features.
10. User privacy is a first-class requirement.

---

# Technology Vision

The Companion Core should eventually support:

- OpenAI
- Anthropic
- Google Gemini
- Local Models
- Future Models

Changing providers should never change the companion's personality or memories.

---

# Development Workflow

Every new feature follows this process:

```
Idea
    │
    ▼
Blueprint
    │
    ▼
Architecture Review
    │
    ▼
Implementation
    │
    ▼
Testing
    │
    ▼
Documentation Update
```

No feature should be implemented before it has been designed.

---

# Long-Term Goal

Imagine using Companion AI every day for five years.

The companion should remember:

- Conversations
- Experiences
- Goals
- Projects
- Preferences
- Relationships
- Achievements

It should grow alongside the user rather than starting over every conversation.

---

# Current Development Status

Current Phase:

✅ AR Foundation

Current Objective:

Build the Companion Core architecture before implementing advanced AI capabilities.

Upcoming Milestones:

- Companion Core
- Memory Engine
- Decision Engine
- Planning Engine
- Reflection Engine
- Tool System
- Voice
- Vision
- Autonomous Assistance

---

# Repository Philosophy

This repository documents not only **how Companion AI is built**, but **how Companion AI thinks**.

Every document in this repository should answer one question:

> "If another engineer joined the project in three years, could they understand and continue building Companion AI without guessing?"

If the answer is "yes," then the documentation has achieved its purpose.