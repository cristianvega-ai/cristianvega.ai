// The reading star: the way back from a detail page.
//
// - Its figure lines draw in turn as the reader moves down the page, toward
//   Vega, and Vega lights at the end. A page that does not scroll shows the
//   whole figure.
// - It links one level up. When the previous history entry is the homepage
//   or that parent page, it goes back through history instead, so the page
//   keeps its scroll position, and the label names that page.
// - Escape follows the star.
// - The listeners stop on pagehide and start again when the browser restores
//   the page from its cache.

/** A page this short does not scroll, so the star shows its whole figure. */
const MINIMUM_SCROLL = 8;
/** The share of the page after which Vega lights. */
const COMPLETE_PROGRESS = 0.985;

type NavigationEntry = { url: string | null };
type NavigationHistory = { currentEntry: { index: number } | null; entries(): NavigationEntry[] };

/** The previous same-origin history entry, when the Navigation API exposes it. */
function previousEntryPath(): string | null {
  const history = (window as unknown as { navigation?: NavigationHistory }).navigation;
  const index = history?.currentEntry?.index;
  if (!history || index === undefined || index < 1) return null;
  const url = history.entries()[index - 1]?.url;
  if (!url) return null;
  const address = new URL(url);
  return address.origin === location.origin ? address.pathname : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
}

export function setupReadingStar(): void {
  const star = document.querySelector<HTMLElement>("[data-reading-star]");
  const link = star?.querySelector<HTMLAnchorElement>(".reading-star__link");
  if (!star || !link) return;
  const lines = [...star.querySelectorAll<SVGPathElement>(".mark__line")];
  const label = star.querySelector<HTMLElement>(".reading-star__label");

  // The star returns through history to the homepage or to its parent page.
  const parentPath = new URL(link.href).pathname;
  const previousPath = previousEntryPath();
  const returnsThroughHistory = previousPath === "/" || previousPath === parentPath;
  // The address and the label name the same page, so a new-tab click opens
  // what the star says.
  if (previousPath === "/") {
    link.href = "/";
    if (label) label.textContent = "Home";
  }

  const goBack = () => {
    if (returnsThroughHistory) history.back();
    else location.href = link.href;
  };

  let maximumScroll = 0;
  let frame = 0;

  const draw = () => {
    frame = 0;
    const progress = maximumScroll < MINIMUM_SCROLL ? 1 : Math.min(1, Math.max(0, scrollY / maximumScroll));
    lines.forEach((line, lineIndex) => {
      line.style.strokeDashoffset = String(1 - Math.min(1, Math.max(0, progress * lines.length - lineIndex)));
    });
    star.classList.toggle("reading-star--complete", progress > COMPLETE_PROGRESS);
  };

  const measure = () => {
    maximumScroll = document.documentElement.scrollHeight - innerHeight;
    draw();
  };

  const scheduleDraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const followLink = (event: MouseEvent) => {
    if (!returnsThroughHistory || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goBack();
  };

  const followEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTypingTarget(event.target)) return;
    goBack();
  };

  const resizeObserver = new ResizeObserver(measure);

  const start = () => {
    addEventListener("scroll", scheduleDraw, { passive: true });
    addEventListener("resize", measure);
    addEventListener("keydown", followEscape);
    link.addEventListener("click", followLink);
    resizeObserver.observe(document.body);
    measure();
  };

  const stop = () => {
    removeEventListener("scroll", scheduleDraw);
    removeEventListener("resize", measure);
    removeEventListener("keydown", followEscape);
    link.removeEventListener("click", followLink);
    resizeObserver.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  addEventListener("pagehide", stop);
  addEventListener("pageshow", (event) => {
    if (event.persisted) start();
  });
  start();
}
