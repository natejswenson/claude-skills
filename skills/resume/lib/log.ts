/**
 * Structured JSON logging for security-relevant events (#14 / B8).
 *
 * Why JSON-per-line: Vercel Logs, Better Stack, Axiom, Datadog, Sentry
 * Breadcrumbs — every log aggregator we might adopt can filter and alert
 * on structured fields. `console.warn("foo happened email=bar")` can
 * only be matched by fragile regex. Emitting `{"event":"foo","email":"bar"}`
 * lets the aggregator index `event=foo` directly.
 *
 * This does NOT replace Sentry for uncaught exceptions. When/if the
 * operator adds Sentry, `logError` becomes a natural shim site — but
 * today the module has zero external deps, works on any platform, and
 * ships no PII by construction (callers choose fields explicitly).
 *
 * Convention: the `event` field is a stable identifier. Alert rules bind
 * to it. DO NOT reword an existing event string without updating alerts.
 */

type LogFields = Record<string, unknown>;

interface LogLine {
  ts: string;
  level: "info" | "warn" | "error";
  event: string;
  [key: string]: unknown;
}

function emit(level: LogLine["level"], event: string, fields: LogFields): void {
  const line: LogLine = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const serialized = JSON.stringify(line);
  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export function logInfo(event: string, fields: LogFields = {}): void {
  emit("info", event, fields);
}

export function logWarn(event: string, fields: LogFields = {}): void {
  emit("warn", event, fields);
}

/**
 * Emit an error-level structured event. Callers pass `err` so the
 * message + stack land in the JSON payload alongside their own fields.
 * When Sentry is wired, this function is the single point to shim.
 */
export function logError(
  event: string,
  err: unknown,
  fields: LogFields = {},
): void {
  const errorFields: LogFields =
    err instanceof Error
      ? { error_name: err.name, error_message: err.message, stack: err.stack }
      : { error: String(err) };
  emit("error", event, { ...errorFields, ...fields });
}
