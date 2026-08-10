import { describe, expect, it } from "vitest";
import {
  isRuntimePlatformCompatible,
  type MeasuredNodeEnvironment,
} from "../src/infrastructure/python-process-evaluation-adapter.js";

const capabilities: Pick<MeasuredNodeEnvironment, "capabilityFlags"> = {
  capabilityFlags: {
    reliableMemoryLimit: false,
    networkIsolation: false,
    processTreeTermination: true,
  },
};

describe("W3 D47 evaluator runtime platform compatibility", () => {
  it("accepts Windows x64 without comparing the Windows build number", () => {
    expect(isRuntimePlatformCompatible(capabilities, "win32", "x64")).toBe(true);
  });

  it.each([
    ["linux", "x64"],
    ["darwin", "x64"],
    ["win32", "arm64"],
  ])("rejects unsupported platform %s/%s", (platform, arch) => {
    expect(isRuntimePlatformCompatible(capabilities, platform, arch)).toBe(false);
  });

  it("requires the approved process-tree termination capability", () => {
    const unsupported = {
      capabilityFlags: {
        ...capabilities.capabilityFlags,
        processTreeTermination: false,
      },
    };

    expect(isRuntimePlatformCompatible(unsupported, "win32", "x64")).toBe(false);
  });
});
