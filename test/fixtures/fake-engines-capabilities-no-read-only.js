#!/usr/bin/env bun
// Stands in for a forge614-engines that predates 1.17.0: `capabilities`
// answers without the `supportsReadOnly` field, which is exactly how such an
// Engines behaves (it also ignores `--read-only` without an error, so the
// field's absence is the only warning Workers gets).
console.log(
  JSON.stringify({
    schemaVersion: 1,
    id: "claude-code",
    label: "Claude Code",
    supportsMcp: true,
    supportsHooks: true,
    supportsHeadlessExec: true,
    supportsReasoningLevel: true,
    fullySupported: true,
  })
);
