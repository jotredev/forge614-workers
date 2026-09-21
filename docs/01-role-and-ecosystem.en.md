# 01. Role and ecosystem

## Analogy

Workers is a production line: Atlas supplies numbered orders; Workers puts one order at a station, waits for the result, and moves to the next. Engines translates the order into the station's command. Engram stores knowledge later, but Workers never writes to that store.

## Product flow

```text
forge614-atlas / forge614-ai
        │ already-decided task list
        ▼
forge614-workers ──► forge614-engines headless
        │                       │ resolved command
        ▼                       ▼
Claude Code or Codex process ──► NDJSON events
        │
        └── Atlas validates and writes results to Engram
```

Forge614 Shell is the only visual interface. Workers, Engines, and Engram are machine interfaces: JSON/NDJSON, with no TUI.

## Responsibilities

Workers guarantees sequential order, `stdin` delivery, an empty temporary `cwd`, timeouts, capture limits, adapter quota detection, and terminal events.

Atlas owns planning and correlates `task.id` with Engram sessions. Engines detects agents and builds commands. Engram stores validated knowledge. These responsibilities are not duplicated.

## Non-goals

Workers does not preflight compatibility, query `capabilities`, retry, repair model or reasoning parameters, interpret content, measure tokens, or persist state.
