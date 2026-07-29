# Planning Engine

> Version: 1.0
> Status: Draft

---

# Purpose

The Planning Engine transforms goals into executable plans.

Unlike the Decision Engine, which decides the next action, the Planning Engine thinks across multiple steps and longer time horizons.

Its purpose is to help the Companion achieve objectives rather than simply reacting to user input.

---

# Philosophy

The Companion should not only answer questions.

It should think ahead.

Planning allows the Companion to:

- organize work
- break down complex goals
- anticipate future needs
- monitor progress
- adapt plans over time

---

# Responsibilities

The Planning Engine is responsible for:

- creating plans
- updating plans
- prioritizing plans
- tracking progress
- detecting blocked tasks
- recommending next steps
- coordinating tools
- coordinating memories

---

# High-Level Architecture

```
                 Goal
                   │
                   ▼
           Planning Engine
                   │
      ┌────────────┼────────────┐
      │            │            │
 Task Builder   Priority     Scheduler
      │            │            │
      └────────────┼────────────┘
                   ▼
            Execution Queue
                   │
                   ▼
           Decision Engine
```

---

# Types of Plans

## Immediate Plans

Duration:

Seconds

Examples:

Answer a question.

Walk to user.

Search memory.

---

## Session Plans

Duration:

Minutes

Examples:

Debug a project.

Study together.

Shopping list.

---

## Daily Plans

Duration:

Hours

Examples:

Finish documentation.

Exercise.

Review tasks.

---

## Long-Term Plans

Duration:

Weeks or Months

Examples:

Build Companion AI.

Learn a language.

Prepare for exams.

Fitness goals.

Career goals.

---

# Planning Pipeline

```
Goal

↓

Understand Goal

↓

Break into Milestones

↓

Break into Tasks

↓

Estimate Difficulty

↓

Estimate Time

↓

Assign Priority

↓

Schedule

↓

Monitor Progress

↓

Update Plan
```

---

# Goal Breakdown

Example:

Goal

↓

Launch Companion AI

↓

Backend

Unity

Memory

Voice

Website

Testing

↓

Individual Tasks

↓

Completed Tasks

---

# Task Object

Every task contains:

Task ID

Title

Description

Status

Priority

Estimated Time

Dependencies

Related Goals

Created Date

Due Date

Completion Date

Notes

---

# Priority Levels

Critical

High

Medium

Low

Background

Priority is dynamic.

The Planning Engine may change priorities based on context.

---

# Dependencies

Example

```
Publish App

↓

Requires

↓

Testing Complete

↓

Requires

↓

Memory Engine Complete
```

The Planning Engine should never schedule impossible work.

---

# Progress Tracking

Every goal maintains:

Completion %

Current Milestone

Blocked Tasks

Completed Tasks

Remaining Tasks

Estimated Finish Date

---

# Replanning

Plans are never fixed.

When new information arrives:

Recalculate.

Update priorities.

Adjust deadlines.

Create new tasks.

Remove obsolete tasks.

---

# Collaboration

Future feature.

The Planning Engine should support:

Multiple users

Shared projects

Shared tasks

Delegation

---

# Memory Integration

Planning uses memory.

Example:

The user usually works on Unity first.

↓

Future plans reflect that preference.

---

# Decision Integration

Planning creates options.

Decision chooses the next action.

Planning never executes.

Decision never creates long-term strategy.

---

# World Integration

Examples:

Phone battery

Location

Available devices

Internet connection

Time of day

Current activity

Planning adapts accordingly.

---

# Success Criteria

The Planning Engine succeeds when:

Large goals become manageable.

Plans evolve naturally.

Tasks stay organized.

The Companion proactively helps.

Planning reduces user workload.

---

# Open Questions

Should plans expire?

Should plans merge automatically?

Can users edit generated plans?

Should the Companion create plans autonomously?

---

# Future Improvements

Project planning

Team planning

Calendar integration

Predictive scheduling

Adaptive workloads

AI collaboration

---

# Risks

Overplanning

Plan conflicts

Outdated plans

Incorrect priorities

User frustration

---

# Implementation Checklist

- Goal Objects
- Task Objects
- Milestones
- Scheduler
- Dependency Graph
- Priority System
- Progress Tracking
- Replanning
- Planning API

---

# References

03_Companion_Core.md

10_Decision_Engine.md

16_Goal_Engine.md

18_Memory_Architecture.md