// Make wide code and figures reachable by keyboard, and show the copy button.
export function setupArticle(): void {
  for (const element of document.querySelectorAll<HTMLElement>(".prose pre, .figure__panel")) {
    element.tabIndex = 0;
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", element.matches("pre") ? "Code example" : "Pipeline diagram");
  }

  const button = document.querySelector<HTMLButtonElement>("[data-copy-link]");
  if (!button || !navigator.clipboard?.writeText) return;
  button.hidden = false;
  button.addEventListener("click", async () => {
    const status = document.querySelector<HTMLElement>(".share-status");
    try {
      await navigator.clipboard.writeText(button.dataset.copyLink!);
      if (status) status.textContent = "Link copied.";
    } catch {
      if (status) status.textContent = "Copy the address from your browser to share this post.";
    }
  });
}
