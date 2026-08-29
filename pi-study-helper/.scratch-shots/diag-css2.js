(async () => {
  const shell = document.querySelector(".app-shell");
  document.querySelector(".sidebar-toggle")?.click();
  await new Promise((r) => setTimeout(r, 800));
  const found = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const r of list) {
        if (r.cssRules) { walk(r.cssRules); continue; }
        if (r.selectorText && /data-sidebar=.?pinned/.test(r.selectorText) && r.style && r.style.gridTemplateColumns) {
          found.push({ sel: r.selectorText, cols: r.style.gridTemplateColumns, media: r.parentRule?.conditionText ?? null });
        }
      }
    };
    walk(rules);
  }
  return { attr: shell.getAttribute("data-sidebar"), computed: getComputedStyle(shell).gridTemplateColumns, found };
})()
