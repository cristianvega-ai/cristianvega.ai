// Keep authored attributes and supply defaults for code and diagrams.
export function setupArticle(): void {
  const article = document.querySelector<HTMLElement>(".article");
  if (!article) return;

  for (const element of article.querySelectorAll<HTMLElement>(".prose pre, .figure__panel")) {
    if (!element.hasAttribute("tabindex")) element.tabIndex = 0;
    if (!element.hasAttribute("role")) element.setAttribute("role", "region");
    if (!element.hasAttribute("aria-label") && !element.hasAttribute("aria-labelledby")) {
      element.setAttribute("aria-label", element.matches("pre") ? "Code example" : "Diagram");
    }
  }

  const button = article.querySelector<HTMLButtonElement>("[data-copy-link]");
  if (!button || !navigator.clipboard?.writeText) return;
  button.hidden = false;
  button.addEventListener("click", async () => {
    const status = article.querySelector<HTMLElement>(".share-status");
    try {
      await navigator.clipboard.writeText(button.dataset.copyLink!);
      if (status) status.textContent = "Link copied.";
    } catch {
      if (status) status.textContent = "Copy the address from your browser to share this post.";
    }
  });
}
