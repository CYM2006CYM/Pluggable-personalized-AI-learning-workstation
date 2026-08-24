import { describe, expect, it } from "vitest";
import { resolveDemoModelMode } from "../src/demo/runtime-mode.js";

const liveEnv = {
  OPENAI_MODEL: "deepseek-chat",
  OPENAI_BASE_URL: "https://api.example.test/v1",
  OPENAI_API_KEY: "local-only-key",
};

describe("demo model mode", () => {
  it("keeps the normal demo deterministic without host model configuration", () => {
    expect(resolveDemoModelMode(["node", "launcher.js"], {})).toBe("recorded_response");
  });

  it("automatically selects live mode when all host variables are present", () => {
    expect(resolveDemoModelMode(["node", "launcher.js"], liveEnv)).toBe("live_model");
  });

  it("keeps explicit live mode available", () => {
    expect(resolveDemoModelMode(["node", "launcher.js", "--live"], liveEnv)).toBe("live_model");
  });

  it("rejects partial host configuration instead of silently using recordings", () => {
    expect(() => resolveDemoModelMode(["node", "launcher.js"], {
      OPENAI_MODEL: "deepseek-chat",
    })).toThrow("OPENAI_MODEL、OPENAI_BASE_URL、OPENAI_API_KEY必须同时配置");
  });
});
