// Count pageviews behind the Astro ClientRouter.
//
// The vendored count.v5.js counts the first full page load with its own
// onload hook. After that, the ClientRouter swaps pages in place, so no
// further load event fires. This listener counts each completed swap.
// astro:after-swap fires once per swap, after the router updates
// location, and never on the first load. No view is counted twice.
//
// count.v5.js loads async. When a swap comes before it runs, the guard
// skips the call. The late onload count then counts the new page.
//
// count.v5.js is vendored from https://gc.zgo.at/count.v5.js (ISC
// license). tests/build.test.mjs pins its exact bytes by hash.
//
// The .htaccess cache policy keeps /js/ files for up to one year. If you
// change this file, rename it and update BaseLayout.astro.
document.addEventListener("astro:after-swap", function () {
  if (window.goatcounter && typeof window.goatcounter.count === "function") {
    window.goatcounter.count();
  }
});
