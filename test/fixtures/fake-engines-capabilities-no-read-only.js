#!/usr/bin/env bun
// Simula un Engines anterior a 1.17.0: `capabilities` responde sin el campo `supportsReadOnly`, igual que lo haría ese Engines (que además ignora
// `--read-only` sin dar error, así que la ausencia del campo es el único aviso que recibe Workers). Lo usa la prueba «returns false when capabilities has no supportsReadOnly field (an Engines older than 1.17.0)» de `src/engines-client.test.ts`.
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
