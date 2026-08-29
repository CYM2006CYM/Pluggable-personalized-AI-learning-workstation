(async () => {
  const root = document.documentElement;
  const shell = document.querySelector(".app-shell");
  const varW = getComputedStyle(root).getPropertyValue("--sidebar-w").trim();
  let sheetInfo = [];
  let pinnedSnippets = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (e) { sheetInfo.push({ href: sheet.href, err: String(e) }); continue; }
    sheetInfo.push({ href: sheet.href, ruleCount: rules.length });
    const walk = (list) => { for (const r of list) { try { if (r.cssRules) { walk(r.cssRules); continue; } } catch { continue; } if (r.cssText && r.cssText.includes("pinned") && r.cssText.includes("grid-template-columns")) pinnedSnippets.push(r.cssText.slice(0, 160)); } };
    walk(rules);
  }
  shell.style.gridTemplateColumns = "var(--sidebar-w) minmax(0,1fr)";
  const forced = getComputedStyle(shell).gridTemplateColumns;
  shell.style.gridTemplateColumns = "";
  return { varW, sheetInfo, pinnedSnippets: pinnedSnippets.slice(0, 3), forced };
})()
