(async () => {
  const shell = document.querySelector(".app-shell");
  const hits = [];
  const walk = (list) => {
    for (const r of list) {
      if (r.selectorText && r.selectorText.includes("data-sidebar=pinned")) hits.push(r.cssText.slice(0, 120));
      if (r.cssRules && r.cssRules.length > 0) walk(r.cssRules);
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch {} }
  document.querySelector(".sidebar-toggle")?.click();
  const samples = [];
  for (const t of [0, 150, 300, 600, 1000]) {
    await new Promise((r) => setTimeout(r, t === 0 ? 0 : t - samples.reduce((a) => a, 0)));
    samples.push(getComputedStyle(shell).gridTemplateColumns.split("(")[0]);
  }
  shell.style.transition = "none";
  shell.style.gridTemplateColumns = "232px minmax(0,1fr)";
  const forced = getComputedStyle(shell).gridTemplateColumns;
  shell.style.gridTemplateColumns = ""; shell.style.transition = "";
  return { hits, samples, forced, inlineAttr: shell.getAttribute("style") };
})()
