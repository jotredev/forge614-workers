/** Contrato que todos los adaptadores cumplen para reconocer cuota agotada y completar el comando que lanza Workers. */
/** Resultado de buscar en las salidas de una tarea una señal propia de cuota agotada. */
export interface QuotaDetectionResult {
  /** `true` cuando alguna regla del adaptador reconoció el agotamiento. */
  matched: boolean;
  /** Patrón que coincidió, incluido en el evento para explicar por qué se detuvo el lote. */
  pattern?: string;
}

/** Reglas específicas de un asistente que el ejecutor aplica después de recibir el comando de Engines. */
export interface EngineAdapter {
  /** Identificador de Engines al que pertenecen estas reglas. */
  agentId: string;
  /** Examina stderr y el prefijo de stdout (sus primeros `QUOTA_STDOUT_PREFIX_BYTES` bytes) para distinguir una cuota agotada de un fallo genérico; el ejecutor solo lo llama cuando el proceso salió con código distinto de cero. */
  detectQuotaExhausted(stderr: string, stdoutPrefix: string): QuotaDetectionResult;

  /**
   * Devuelve las banderas adicionales de CLI (interfaz de línea de comandos) necesarias porque Workers ejecuta
   * en una carpeta nueva, vacía y no confiable (por ejemplo `--skip-git-repo-check` de codex); devuelve `[]` si no
   * hacen falta. El ejecutor las agrega al final de los argumentos que resolvió Engines. Solo cubre esa restricción
   * de carpeta, no modelo, permisos ni salida: esas opciones pertenecen a la resolución de Engines.
   */
  extraArgs(): string[];
}

/** Cuántos bytes del inicio de stdout recibe `detectQuotaExhausted` como `stdoutPrefix`: 4096, cortados por bytes UTF-8 reales. */
export const QUOTA_STDOUT_PREFIX_BYTES = 4096;
