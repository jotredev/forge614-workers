#!/usr/bin/env bun
// Stands in for a forge614-engines whose agent explicitly cannot guarantee
// read-only execution: `capabilities` answers `supportsReadOnly: false`.
console.log(
  JSON.stringify({
    schemaVersion: 1,
    id: "claude-code",
    label: "Claude Code",
    supportsMcp: true,
    supportsHooks: true,
    supportsHeadlessExec: true,
    supportsReasoningLevel: true,
    supportsReadOnly: false,
    fullySupported: true,
  })
);
