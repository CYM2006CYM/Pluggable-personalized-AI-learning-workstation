(async () => {
  const b = document.querySelector(".cta-start");
  if (!b) return "no cta";
  b.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 300));
  b.style.transform = "perspective(420px) rotateX(8deg) translateY(-2px)";
  b.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.5), 0 10px 24px rgba(101,78,48,0.15), 0 2px 6px rgba(101,78,48,0.09)";
  return "hover simulated";
})()
