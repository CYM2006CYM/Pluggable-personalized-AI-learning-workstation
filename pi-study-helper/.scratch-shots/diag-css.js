(() => {
  const found = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const r of list) {
        if (r.cssRules) { walk(r.cssRules); continue; }
        if (r.selectorText && r.selectorText.includes('data-sidebar="pinned"') && r.style && r.style.gridTemplateColumns) {
          found.push({ sel: r.selectorText, cols: r.style.gridTemplateColumns, sheetHref: sheet.href });
        }
      }
    };
    walk(rules);
  }
  const shell = document.querySelector(".app-shell");
  return { found, computed: getComputedStyle(shell).gridTemplateColumns, attr: shell.getAttribute("data-sidebar") };
})()
