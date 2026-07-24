const THEME_KEY = "keva-theme";
const THEME_COLOR = { light: "#fafafa", dark: "#1b1b1d" } as const;

const toggle = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

if (toggle) {
  const stored = (() => {
    try {
      const value = localStorage.getItem(THEME_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  })();

  // The theme is only pinned once the visitor picks one; until then it follows the
  // OS, which plain CSS already handles via light-dark().
  let override: "light" | "dark" | null = stored;

  const sync = () => {
    const resolved = override ?? (systemDark.matches ? "dark" : "light");
    if (override) document.documentElement.dataset.theme = override;
    else delete document.documentElement.dataset.theme;
    toggle.setAttribute(
      "aria-label",
      resolved === "dark" ? "Switch to light theme" : "Switch to dark theme",
    );
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = override ? THEME_COLOR[override] : THEME_COLOR[resolved];
    }
  };

  sync();
  systemDark.addEventListener("change", sync);
  toggle.addEventListener("click", () => {
    override = (override ?? (systemDark.matches ? "dark" : "light")) === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, override);
    } catch {}
    sync();
  });
}

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
