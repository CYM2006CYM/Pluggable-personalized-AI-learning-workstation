(() => {
  const wrap = document.querySelector(".sp-bookmark-wrap");
  const btn = document.querySelector(".sp-bookmark");
  if (!wrap || !btn) return { exists: { wrap: !!wrap, btn: !!btn } };
  const r = wrap.getBoundingClientRect();
  const s = getComputedStyle(wrap);
  const chain = [];
  let el = btn;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none") chain.push(`${el.className || el.tagName}:${cs.backgroundColor}`);
    el = el.parentElement;
  }
  return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, z: s.zIndex, transform: s.transform, bgChain: chain };
})()
