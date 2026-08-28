import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createPiGraphHost, type Graph, type GraphHost, type GraphRunResult } from "pi-loop-graph-sdk";
import type { IsolatedGraphExecutor } from "../graphs/isolated-graph-executor.js";
import { PiGraphModelExecutionAdapter, type ModelExecutionPort } from "./model-execution-port.js";

const PROVIDER_ID = "w4-openai-compatible";

export interface LiveModelExecutionPortOptions {
  cwd: string;
  modelId?: string;
  baseUrl?: string;
  apiKey?: string;
  graphs: readonly Graph[];
  createHost?: typeof createPiGraphHost;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new TypeError(`${name} is required for demo:live`);
  return normalized;
}

function liveBaseUrl(value: string | undefined): string {
  const raw = required(value, "OPENAI_BASE_URL");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("OPENAI_BASE_URL must be an absolute HTTP(S) URL");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "") {
    throw new TypeError("OPENAI_BASE_URL must be an absolute HTTP(S) URL without credentials");
  }
  return parsed.toString().replace(/\/$/u, "");
}

/** D-owned live SDK boundary. Credentials stay in an in-memory AuthStorage. */
export function createLiveModelExecutionPort(options: LiveModelExecutionPortOptions): ModelExecutionPort {
  const modelId = required(options.modelId, "OPENAI_MODEL");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(modelId)) throw new TypeError("OPENAI_MODEL must be a stable model identifier");
  const baseUrl = liveBaseUrl(options.baseUrl);
  const apiKey = required(options.apiKey, "OPENAI_API_KEY");

  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(PROVIDER_ID, apiKey);
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider(PROVIDER_ID, {
    name: "W4 OpenAI-compatible live provider",
    baseUrl,
    apiKey,
    api: "openai-completions",
    models: [{
      id: modelId,
      name: modelId,
      api: "openai-completions",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8_192,
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    }],
  });
  const model = modelRegistry.find(PROVIDER_ID, modelId);
  if (model === undefined) throw new Error("live model registration failed");
  const createHost = options.createHost ?? createPiGraphHost;
  const executor: IsolatedGraphExecutor = async (graph, input, signal) => {
    const host: GraphHost = await createHost({
      cwd: options.cwd,
      authStorage,
      modelRegistry,
      model,
      thinkingLevel: "off",
      recording: "off",
      graphs: options.graphs,
    });
    try {
      return await host.execute(graph, input as never, signal === undefined ? undefined : { signal }) as GraphRunResult;
    } finally {
      await host.dispose();
    }
  };
  return new PiGraphModelExecutionAdapter({ executor, graphs: options.graphs, modelId });
}
