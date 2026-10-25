// The Lyra mark: the angle it has in the sky now, and its ready state.
//
// It loads as a classic script in the head and writes the angle to the
// `--sky-angle` custom property before the first render. Every mark on the
// page then turns from its first frame. That matters in a page transition,
// where the homepage mark flies into the reading star: both must stand at
// the same angle. A visitor without JavaScript sees the figure upright.
//
// The angle is the parallactic angle of Vega: the turn between celestial
// north and straight up for an observer. The latitude is a fixed 40° north,
// and the visitor's time zone gives an approximate longitude.
(() => {
  const VEGA_RIGHT_ASCENSION = 279.2347; // degrees, J2000
  const VEGA_DECLINATION = 38.7837; // degrees, J2000
  const OBSERVER_LATITUDE = 40;
  const radians = (degrees) => (degrees * Math.PI) / 180;

  const skyAngle = (date) => {
    const julianDate = date.getTime() / 86_400_000 + 2_440_587.5;
    const greenwichSiderealTime = 280.46061837 + 360.98564736629 * (julianDate - 2_451_545);
    // getTimezoneOffset is minutes behind UTC, and the sky turns 1° in 4 minutes.
    const longitude = -date.getTimezoneOffset() / 4;
    const hourAngle = radians(greenwichSiderealTime + longitude - VEGA_RIGHT_ASCENSION);
    const angle = Math.atan2(
      Math.sin(hourAngle),
      Math.tan(radians(OBSERVER_LATITUDE)) * Math.cos(radians(VEGA_DECLINATION)) -
        Math.sin(radians(VEGA_DECLINATION)) * Math.cos(hourAngle),
    );
    return (angle * 180) / Math.PI;
  };

  document.documentElement.style.setProperty("--sky-angle", `${skyAngle(new Date()).toFixed(2)}deg`);

  // The homepage mark draws itself, then stays ready: Vega breathes and a
  // pointer redraws the lines. With reduced motion there is no entrance, so
  // the mark is ready at once.
  const markReady = (mark) => mark.classList.replace("mark--draw", "mark--ready");

  document.addEventListener("animationend", (event) => {
    if (event.animationName !== "mark-bloom" || !(event.target instanceof Element)) return;
    const mark = event.target.closest(".mark--draw");
    if (mark) markReady(mark);
  });

  document.addEventListener("DOMContentLoaded", () => {
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const mark of document.querySelectorAll(".mark--draw")) markReady(mark);
  });
})();
