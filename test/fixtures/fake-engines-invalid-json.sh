#!/bin/sh
# Simula un Engines que se porta mal: escribe en stdout un texto que no es JSON y sale con 0. Lo usan `src/engines-client.test.ts` para
# comprobar `ENGINES_RESPONSE_INVALID` en `resolveHeadlessCommand` y el `false` de `engineSupportsReadOnly`, sin depender de que el Engines real falle.
echo "not valid json {{{ this is not parseable"
exit 0
