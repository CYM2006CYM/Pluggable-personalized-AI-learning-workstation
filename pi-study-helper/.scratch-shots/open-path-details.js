(() => {
  const out = [];
  document.querySelectorAll('[data-page="path"] summary, .path-section summary').forEach((s) => {
    if (s.textContent.includes("路径明细") || s.textContent.includes("时间与诊断依据")) { s.click(); out.push(s.textContent.slice(0, 12)); }
  });
  return out;
})()
