# AI Agent Engineering Roadmap

## Goal

Build a production-ready **Coding & Deployment AI Agent** while learning
the core concepts behind modern AI agents.

------------------------------------------------------------------------

# Phase 1 -- LLM Fundamentals (Week 1)

## Learn

-   What is an LLM?
-   Tokens and context windows
-   Prompt engineering
-   Temperature
-   Function (tool) calling
-   Structured outputs

## Build

### Lesson 1: Calculator Agent

-   Accept a math question
-   Call a calculator tool
-   Return the answer

### Lesson 2: Weather Agent

-   Call a weather API
-   Decide when to use the tool
-   Format the response

**Concepts:** Tool calling, API integration, JSON outputs

------------------------------------------------------------------------

# Phase 2 -- Agent Basics (Week 2)

## Learn

-   Agent loop (Think → Act → Observe)
-   Planning vs execution
-   Short-term memory

## Build

### Lesson 3: File Agent

-   Read files
-   Search directories
-   Summarize a project

### Lesson 4: Terminal Agent

-   Run safe shell commands
-   Capture output
-   Explain errors

**Concepts:** Tools, execution, observations

------------------------------------------------------------------------

# Phase 3 -- RAG (Week 3)

## Learn

-   Embeddings
-   Chunking
-   Vector databases
-   Retrieval

## Build

### Lesson 5: Documentation Assistant

-   Index a repository
-   Answer questions about the codebase

### Lesson 6: Repository Search Agent

-   Find relevant files before answering

**Concepts:** Context retrieval, semantic search

------------------------------------------------------------------------

# Phase 4 -- Memory (Week 4)

## Learn

-   Conversation memory
-   Long-term memory
-   Session state

## Build

### Lesson 7: Personal Coding Assistant

-   Remember coding preferences
-   Recall previous tasks

------------------------------------------------------------------------

# Phase 5 -- Agent Frameworks (Week 5)

## Learn

-   OpenAI Agents SDK
-   LangGraph state machines
-   Human-in-the-loop
-   Checkpointing

## Build

### Lesson 8: Multi-step Task Agent

-   Plan
-   Execute
-   Retry on failure

------------------------------------------------------------------------

# Phase 6 -- GitHub Automation (Week 6)

## Learn

-   Git workflows
-   Pull requests
-   Branching
-   GitHub APIs

## Build

### Lesson 9: GitHub Agent

-   Create issues
-   Open PRs
-   Review commits

------------------------------------------------------------------------

# Phase 7 -- Coding Agent (Weeks 7--8)

## Learn

-   Repository understanding
-   Code generation
-   Refactoring
-   Testing

## Build

### Lesson 10: Coding Agent

-   Read code
-   Modify files
-   Run lint
-   Run tests
-   Fix simple failures

Pipeline:

User → Planner → Repository Search → Coding → Testing

------------------------------------------------------------------------

# Phase 8 -- Deployment Agent (Week 9)

## Learn

-   Docker
-   CI/CD
-   GitHub Actions
-   Kubernetes basics
-   Health checks
-   Rollbacks

## Build

### Lesson 11: Deployment Agent

-   Build Docker image
-   Trigger CI
-   Deploy to staging
-   Verify health
-   Roll back if needed

------------------------------------------------------------------------

# Phase 9 -- Multi-Agent Platform (Weeks 10--11)

## Build

Planner Agent

↓

Coding Agent

↓

Testing Agent

↓

Review Agent

↓

Deployment Agent

↓

Monitoring Agent

Responsibilities: - Planner: task decomposition - Coding:
implementation - Testing: validation - Review: quality/security -
Deployment: release - Monitoring: post-deployment checks

------------------------------------------------------------------------

# Phase 10 -- Production Readiness (Week 12)

## Learn

-   Authentication
-   Authorization
-   Secret management
-   Logging
-   Tracing
-   Cost monitoring
-   Observability
-   Sandboxed execution

## Build

### Lesson 12: Production AI Platform

-   Web dashboard
-   Task history
-   Agent logs
-   Approval workflow
-   Metrics

------------------------------------------------------------------------

# Final Capstone

Build an AI Software Engineer platform.

Features: - Chat interface - Planner agent - Coding agent - Testing
agent - GitHub integration - Deployment agent - Monitoring agent -
Notifications - Memory - RAG - Human approvals

------------------------------------------------------------------------

# Suggested Tech Stack

-   TypeScript
-   NestJS
-   React
-   Docker
-   GitHub Actions
-   OpenAI Agents SDK
-   LangGraph
-   Ollama
-   PostgreSQL
-   FAISS or LanceDB
-   OpenTelemetry

------------------------------------------------------------------------

# Success Criteria

By the end of this roadmap you should be able to: - Build single-agent
and multi-agent systems - Design tool-based workflows - Implement RAG
and memory - Automate GitHub tasks - Build a coding agent - Build a
deployment agent - Orchestrate production-ready AI agents
