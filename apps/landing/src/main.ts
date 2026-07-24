const header = document.querySelector<HTMLElement>("[data-header]");

if (header) {
  const syncHeader = () => header.classList.toggle("is-stuck", window.scrollY > 8);
  syncHeader();
  window.addEventListener("scroll", syncHeader, { passive: true });
}

const reveals = document.querySelectorAll<HTMLElement>(".reveal");
const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    }
  },
  { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
);
for (const element of reveals) revealObserver.observe(element);

// Looping product demos only run while on screen, so at most one or two play at a time.
const demos = document.querySelectorAll<HTMLElement>("[data-demo]");
const demoObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) entry.target.classList.toggle("is-live", entry.isIntersecting);
  },
  { threshold: 0.35 },
);
for (const demo of demos) demoObserver.observe(demo);
