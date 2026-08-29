(() => {
  const shell = document.querySelector(".app-shell");
  const aside = document.querySelector(".app-sidebar");
  const toggle = document.querySelector(".sidebar-toggle");
  if (toggle) toggle.click();
  return new Promise((resolve) => setTimeout(() => {
    const panel = document.querySelector(".sidebar-panel");
    resolve({
      dataset: shell?.dataset.sidebar,
      cols: getComputedStyle(shell).gridTemplateColumns,
      asideW: aside?.getBoundingClientRect().width,
      asidePad: getComputedStyle(aside).padding,
      toggleExpanded: toggle?.getAttribute("aria-expanded"),
      panelVisible: panel ? getComputedStyle(panel).visibility : "none",
      panelW: panel?.getBoundingClientRect().width,
      brandStrongDisplay: getComputedStyle(document.querySelector(".brand-block strong")).display,
    });
  }, 600));
})()
