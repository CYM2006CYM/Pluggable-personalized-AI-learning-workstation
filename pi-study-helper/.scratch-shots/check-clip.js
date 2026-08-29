(() => {
  const el = document.querySelector(".csv-sample");
  if (!el) return "no .csv-sample";
  const before = getComputedStyle(el, "::before");
  const after = getComputedStyle(el, "::after");
  return {
    beforeBg: before.backgroundImage.slice(0, 60), beforePos: before.top + "/" + before.left,
    afterBg: after.backgroundImage.slice(0, 100), afterPos: after.top + "/" + after.left, afterTransform: after.transform,
  };
})()
