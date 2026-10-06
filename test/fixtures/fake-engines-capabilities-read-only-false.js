#!/usr/bin/env bun
// Simula un Engines cuyo asistente declara explícitamente que no garantiza el solo lectura: `capabilities` responde `supportsReadOnly: false`.
// Lo usa la prueba «returns false when capabilities says supportsReadOnly is false» de `src/engines-client.test.ts`.
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
