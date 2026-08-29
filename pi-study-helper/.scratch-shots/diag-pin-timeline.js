(async () => {
  const shell = document.querySelector(".app-shell");
  document.querySelector(".sidebar-toggle")?.click();
  const samples = [];
  for (const t of [0, 200, 500, 800, 1100, 1400, 1700, 2000]) {
    await new Promise((r) => setTimeout(r, t === 0 ? 0 : 200));
    samples.push({ t, attr: shell.getAttribute("data-sidebar"), cols: getComputedStyle(shell).gridTemplateColumns.split(" ")[0] });
  }
  return samples;
})()
