(async () => {
  location.hash = "#study";
  await new Promise((r) => setTimeout(r, 400));
  const target = document.querySelector(".lesson-stack") ?? document.querySelector(".stack-nav");
  if (target) target.scrollIntoView({ block: "start" });
  await new Promise((r) => setTimeout(r, 200));
  return { y: window.scrollY, callouts: document.querySelectorAll(".lesson-callout").length, facts: document.querySelectorAll(".learn-fact").length };
})()
