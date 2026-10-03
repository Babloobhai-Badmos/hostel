// Phones: go fullscreen + landscape on the first tap (browsers only allow it
// inside a user gesture). If the player exits fullscreen, the next tap
// re-enters it. iPhones have no Fullscreen API; "Add to Home Screen" is the
// workaround there (see README).

const isTouchDevice = () => navigator.maxTouchPoints > 0 || "ontouchstart" in window;

function enterFullscreen(): void {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: "hide" })
    .then(() => {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      return orientation.lock?.("landscape");
    })
    .catch(() => {
      // Not allowed (desktop browser, iOS, or denied). Nothing to do.
    });
}

export function installFullscreenOnTap(): void {
  if (!isTouchDevice()) return;
  // `touchend` and `click` count as user activation everywhere; pointerdown does not on all browsers.
  window.addEventListener("touchend", enterFullscreen, { passive: true });
  window.addEventListener("click", enterFullscreen);
}

/** Block pinch-zoom, double-tap zoom and pull-to-refresh outside text inputs. */
export function preventBrowserGestures(): void {
  const allow = (target: EventTarget | null) =>
    target instanceof HTMLElement && target.closest("input, textarea, .card") !== null;
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!allow(e.target) || e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  // iOS Safari pinch gestures.
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault());
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}
