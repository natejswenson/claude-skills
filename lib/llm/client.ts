/**
 * Both adapters take the same shape: system prompt, user message, optional
 * JSON Schema for structured output, and an optional model override.
 *
 * Return type is `unknown` (the parsed JSON object). The caller is
 * responsible for schema validation via zod — the adapter's job is to get
 * the best possible structured output from the model, but we don't trust
 * it blindly.
 */
export interface LLMClient {
  completeStructured(input: {
    system: string;
    user: string;
    schema: object;
    model?: string;
  }): Promise<unknown>;
}
