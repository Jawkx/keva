type Theme = "light" | "dark";

const storageKey = "keva-landing-theme";
const root = document.documentElement;
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

function storedTheme(): Theme | null {
  const value = localStorage.getItem(storageKey);
  return value === "light" || value === "dark" ? value : null;
}

function applyTheme(theme: Theme) {
  root.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#20201d" : "#f5f1e7");

  const toggle = document.querySelector<HTMLButtonElement>(".theme-toggle");
  if (toggle) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-label", `Switch to ${nextTheme} theme`);
    toggle.title = `Switch to ${nextTheme} theme`;
  }
}

applyTheme(storedTheme() ?? (systemTheme.matches ? "dark" : "light"));

document.querySelector<HTMLButtonElement>(".theme-toggle")?.addEventListener("click", () => {
  const nextTheme: Theme = root.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(storageKey, nextTheme);
  applyTheme(nextTheme);
});

systemTheme.addEventListener("change", (event) => {
  if (!storedTheme()) applyTheme(event.matches ? "dark" : "light");
});
