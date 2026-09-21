# 01. Rol y ecosistema

## Analogía

Workers es una línea de producción: Atlas entrega órdenes numeradas; Workers coloca una orden en una estación, espera su resultado, y pasa a la siguiente. Engines es el intérprete que traduce la orden al comando de la estación. Engram guarda conocimiento después, pero Workers nunca toca ese almacén.

## Flujo entre productos

```text
forge614-atlas / forge614-ai
        │ lista de tareas decididas
        ▼
forge614-workers ──► forge614-engines headless
        │                       │ comando resuelto
        ▼                       ▼
proceso Claude Code o Codex ──► eventos NDJSON
        │
        └── Atlas valida y escribe resultados en Engram
```

Forge614 Shell es la única interfaz visual. Workers, Engines y Engram son interfaces de máquina: JSON/NDJSON, sin TUI.

## Responsabilidades

Workers garantiza orden secuencial, entrega por `stdin`, `cwd` temporal vacío, timeout, límites de captura, detección de cuota por adapter y eventos terminales.

Atlas decide el plan y correlaciona `task.id` con sus sesiones de Engram. Engines detecta agentes y construye comandos. Engram conserva conocimiento validado. Ninguna responsabilidad se duplica.

## No objetivos

Workers no valida previamente compatibilidad, no consulta `capabilities`, no reintenta, no corrige modelos o razonamiento, no interpreta contenido, no mide tokens y no persiste estado.
