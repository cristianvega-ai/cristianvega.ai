// Page transitions between the list pages and the detail pages. The browser's
// cross-document view transitions do the motion. This script only names the
// elements that travel, and browsers without support navigate as usual.
//
// It loads as a classic script in the head, so its listeners exist before the
// first render, when `pagereveal` fires. Astro's own scripts run later. That
// is why this file is plain JavaScript and SiteHead loads it by its address.
//
// - A clicked row title takes the name "title", so it grows into the heading
//   of the next page.
// - A page with a key writes it on `pageswap`. The next page reads it once on
//   `pagereveal`. A list page then names the matching row, so the heading
//   shrinks back into it.
// - A page that opens through a transition skips its own entrance.
(() => {
  const root = document.documentElement;
  const rowTitles = ".entry-row__title";
  const listPages = ["home", "writing", "products"];

  const store = (key, value) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Storage can be off. The transition then runs without the named row.
    }
  };

  const take = (key) => {
    try {
      const value = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      return value;
    } catch {
      return null;
    }
  };

  const clearNames = (selector) => {
    for (const element of document.querySelectorAll(selector)) element.style.viewTransitionName = "";
  };

  // The page heading lets its name go, so only one element has the name. A
  // duplicate name would cancel the whole transition.
  const releaseHeading = () => {
    for (const heading of document.querySelectorAll("[data-morph-title]")) heading.style.viewTransitionName = "none";
  };

  document.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[data-morph-key]") : null;
    const title = link?.querySelector(rowTitles);
    if (!title) return;
    clearNames(rowTitles);
    releaseHeading();
    title.style.viewTransitionName = "title";
  });

  addEventListener("pageswap", () => {
    if (root.dataset.morphKey) store("morph-key", root.dataset.morphKey);
  });

  addEventListener("pagereveal", (event) => {
    const morphKey = take("morph-key");
    if (!event.viewTransition) return;
    root.classList.add("arrived");
    for (const mark of document.querySelectorAll(".mark--draw")) mark.classList.replace("mark--draw", "mark--ready");

    if (!listPages.includes(root.dataset.page ?? "")) return;
    clearNames(rowTitles);
    const link = morphKey ? document.querySelector(`a[data-morph-key="${CSS.escape(morphKey)}"]`) : null;
    const title = link?.querySelector(rowTitles);
    if (!title) return;
    releaseHeading();
    title.style.viewTransitionName = "title";
  });
})();
