export type DemoModelMode = "recorded_response" | "live_model";

const LIVE_VARIABLES = ["OPENAI_MODEL", "OPENAI_BASE_URL", "OPENAI_API_KEY"] as const;

function present(value: string | undefined): boolean {
  return (value?.trim().length ?? 0) > 0;
}

/** Selects live mode only when the complete host configuration is present. */
export function resolveDemoModelMode(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): DemoModelMode {
  const explicitLive = args.includes("--live");
  const configured = LIVE_VARIABLES.map((name) => present(env[name]));
  const anyConfigured = configured.some(Boolean);
  const fullyConfigured = configured.every(Boolean);

  if (anyConfigured && !fullyConfigured) {
    throw new TypeError("OPENAI_MODEL、OPENAI_BASE_URL、OPENAI_API_KEY必须同时配置");
  }
  if (explicitLive || fullyConfigured) return "live_model";
  return "recorded_response";
}
