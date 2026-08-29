(async () => {
  location.hash = "#study";
  await new Promise((r) => setTimeout(r, 500));
  const nav = document.querySelector(".stack-nav");
  if (!nav) return "no nav";
  const read = (tag) => ({ tag, stuckClass: nav.className.includes("is-stuck"), navTop: Math.round(nav.getBoundingClientRect().top), blur: getComputedStyle(nav).backdropFilter });
  const before = read("top");
  window.scrollTo({ top: 99999, behavior: "instant" });
  await new Promise((r) => setTimeout(r, 700));
  const after = read("scrolled");
  return { before, after, maxScroll: document.documentElement.scrollHeight - innerHeight };
})()
