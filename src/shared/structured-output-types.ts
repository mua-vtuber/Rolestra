/**
 * Structured output a call asks the model for (spec 2026-10-08 F2). The chat
 * code builds the schema next to the parser that judges the answer
 * (`src/main/channels/chat-whisper-output.ts`); providers only forward it.
 */

/** The JSON Schema subset this app uses: keys both OpenAI-compatible json_schema and Ollama's grammar conversion accept. */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'null';
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: false;
  items?: JsonSchema;
  maxItems?: number;
  minLength?: number;
  enum?: readonly string[];
  anyOf?: readonly JsonSchema[];
}

/** The output format one call requires. `name` matches ^[a-zA-Z0-9_-]{1,64}$. */
export interface StructuredOutputSpec {
  name: string;
  schema: JsonSchema;
}
