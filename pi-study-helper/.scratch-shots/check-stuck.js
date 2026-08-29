(async () => {
  location.hash = "#study";
  await new Promise((r) => setTimeout(r, 500));
  const nav = document.querySelector(".stack-nav");
  const sentinel = document.querySelector(".stack-nav-sentinel");
  if (!nav || !sentinel) return "missing nodes";
  const read = () => ({
    stuckClass: nav.className.includes("is-stuck"),
    navTop: Math.round(nav.getBoundingClientRect().top),
    bg: getComputedStyle(nav).backgroundColor,
    shadow: getComputedStyle(nav).boxShadow.slice(0, 60),
    blur: getComputedStyle(nav).backdropFilter,
  });
  const before = read();
  window.scrollTo({ top: 900, behavior: "instant" });
  await new Promise((r) => setTimeout(r, 600));
  const after = read();
  window.scrollTo({ top: 0, behavior: "instant" });
  await new Promise((r) => setTimeout(r, 600));
  const back = read();
  return { before, after, back };
})()
