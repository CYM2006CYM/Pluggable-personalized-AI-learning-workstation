import { describe, expect, it } from "vitest";
import { STABLE_LAYOUT } from "../../src/web/styles/layout-contract.js";

describe("W3 D2 stable layout contract", () => {
  it("fixes dimensions for stateful page and activity surfaces", () => {
    expect(STABLE_LAYOUT.statePanelMinHeight).toBe("430px");
    expect(STABLE_LAYOUT.activityStageMinHeight).toBe("476px");
    expect(STABLE_LAYOUT.pathNodeMinHeight).toBe("72px");
    expect(STABLE_LAYOUT.activityTabsHeight).toBe("44px");
  });

  it("provides desktop, tablet, and mobile constraints", () => {
    expect(STABLE_LAYOUT.desktopSidebarWidth).toBe("232px");
    expect(STABLE_LAYOUT.tabletBreakpoint).toBe("980px");
    expect(STABLE_LAYOUT.mobileBreakpoint).toBe("700px");
  });
});
