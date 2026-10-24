// Page transitions between the list pages, the detail pages and the Lab
// scenes. The browser's cross-document view transitions do the motion. This
// script only names the elements that travel, and browsers without support
// navigate as usual.
//
// It loads as a classic script in the head, so its listeners exist before the
// first render, when `pagereveal` fires. Astro's own scripts run later. That
// is why this file is plain JavaScript and SiteHead loads it by its address.
//
// - A clicked row or card title takes the name "title", so it grows into the
//   heading of the next page.
// - A clicked Lab result's clip takes the name "stage", so it grows into the
//   live scene.
// - A page with a key writes it on `pageswap`. The next page reads it once on
//   `pagereveal`. A list page then names the matching row, and an experiment
//   page names the matching clip, so the heading or the stage shrinks back.
// - The arrows on a live scene store their direction, so the next scene
//   slides in from that side.
// - A page that opens through a transition skips its own entrance.
(() => {
  const root = document.documentElement;
  const titles = ".entry-row__title, .lab-card__title";
  const stageMedia = "[data-stage-media]";
  const listPages = ["home", "writing", "products", "lab"];

  // A return from a live scene scrolls to that scene's result, so the
  // browser must not restore an older scroll position over it.
  if (root.dataset.page === "experiment") history.scrollRestoration = "manual";

  const store = (key, value) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Storage can be off. The transition then runs without the named element.
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
    if (!(event.target instanceof Element)) return;
    const title = event.target.closest("a[data-morph-key]")?.querySelector(titles);
    const media = event.target.closest("a[data-stage-key]")?.querySelector(stageMedia);
    const step = event.target.closest("a[data-direction]");
    if (title) {
      clearNames(titles);
      releaseHeading();
      title.style.viewTransitionName = "title";
    }
    if (media) {
      clearNames(stageMedia);
      releaseHeading();
      media.style.viewTransitionName = "stage";
    }
    if (step) store("stage-direction", step.dataset.direction);
  });

  addEventListener("pageswap", () => {
    if (root.dataset.morphKey) store("morph-key", root.dataset.morphKey);
    if (root.dataset.stageKey) store("stage-key", root.dataset.stageKey);
  });

  addEventListener("pagereveal", (event) => {
    const direction = take("stage-direction");
    const morphKey = take("morph-key");
    const stageKey = take("stage-key");

    // The result a visitor returns from scrolls into view, with or without a
    // transition, so the stage shrinks into a visible tile.
    const media = stageKey ? document.querySelector(`a[data-stage-key="${CSS.escape(stageKey)}"] ${stageMedia}`) : null;
    if (media) {
      const box = media.getBoundingClientRect();
      if (box.top < 0 || box.bottom > innerHeight) media.scrollIntoView({ block: "center", behavior: "instant" });
    }

    if (!event.viewTransition) return;
    root.classList.add("arrived");
    for (const mark of document.querySelectorAll(".mark--draw")) mark.classList.replace("mark--draw", "mark--ready");
    if (direction && root.dataset.page === "scene") event.viewTransition.types?.add(direction);

    if (media) {
      clearNames(stageMedia);
      releaseHeading();
      media.style.viewTransitionName = "stage";
    }

    if (!listPages.includes(root.dataset.page ?? "")) return;
    clearNames(titles);
    const link = morphKey ? document.querySelector(`a[data-morph-key="${CSS.escape(morphKey)}"]`) : null;
    const title = link?.querySelector(titles);
    if (!title) return;
    releaseHeading();
    title.style.viewTransitionName = "title";
  });
})();
