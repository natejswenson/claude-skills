/**
 * Both adapters take the same shape: system prompt, user message, optional
 * JSON Schema for structured output, and an optional model override.
 *
 * Return type is `unknown` (the parsed JSON object). The caller is
 * responsible for schema validation via zod — the adapter's job is to get
 * the best possible structured output from the model, but we don't trust
 * it blindly.
 */
/**
 * Optional streaming-progress callback. Adapters that can observe generation
 * incrementally (the CLI adapter via stream-json) invoke this as output
 * accumulates so the UI can prove liveness during a long tailoring pass.
 * Adapters that can't stream simply never call it.
 */
export type ProgressFn = (p: { outChars: number }) => void;

export interface LLMClient {
  completeStructured(input: {
    system: string;
    user: string;
    schema: object;
    model?: string;
    onProgress?: ProgressFn;
  }): Promise<unknown>;
}
