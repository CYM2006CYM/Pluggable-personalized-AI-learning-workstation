(() => {
  const w = window.innerWidth;
  const doc = document.documentElement;
  const offenders = [];
  const tol = 1;
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > w + tol || r.left < -tol)) {
      let p = el.parentElement, inScroller = false;
      while (p) {
        const s = getComputedStyle(p);
        if (s.overflowX === "auto" || s.overflowX === "scroll") { inScroller = true; break; }
        if (p === document.body) break;
        p = p.parentElement;
      }
      if (!inScroller) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}@R${Math.round(r.right)}`);
    }
  });
  return { innerW: w, scrollW: doc.scrollWidth, offenders: offenders.slice(0, 8) };
})()
