/**
 * Motion primitives: springs, momentum projection and rubber-banding.
 *
 * Written by hand rather than pulled from a library — this is a supply-chain
 * security tool, and a few hundred lines of physics is not worth a dependency.
 * The model follows Apple's designer-facing parameterisation: instead of
 * mass/stiffness/damping, a spring is described by a damping *ratio* (how much
 * it overshoots) and a *response* (how quickly it reaches the target, in
 * seconds). A spring has no duration; settle time emerges from those two.
 *
 * The important property is interruptibility: every animation reads the live
 * on-screen value and current velocity, so a new target retargets the motion
 * in flight instead of restarting it. That is what lets a user grab a moving
 * element and reverse it without a visible jump or a velocity discontinuity.
 */
export const MOTION_JS = String.raw`
// ---- Spring ------------------------------------------------------------
// damping 1.0 = critically damped: no overshoot, graceful settle. That is the
// default for ordinary UI. Bounce (damping ~0.8) is reserved for motion the
// user physically threw, where overshoot reads as momentum rather than noise.
const SPRING = {
  ui:      { damping: 1.0, response: 0.34 },  // reposition, view changes
  gesture: { damping: 0.8, response: 0.32 },  // after a flick or drag release
  sheet:   { damping: 0.8, response: 0.3  },  // drawers and sheets
};

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Animate a scalar with a spring, calling back each frame.
 *
 * Returns a handle whose .to() retargets the SAME spring, preserving position
 * and velocity — the difference between a fluid redirect and a restart. The
 * integrator is semi-implicit Euler at a clamped timestep, which stays stable
 * when the tab is throttled or a frame is very long.
 */
function spring(from, to, opts, onFrame) {
  const cfg = opts || SPRING.ui;
  let x = from, target = to, v = opts && opts.velocity || 0, raf = 0, done = false;

  // Convert response/damping into angular frequency + damping coefficient.
  const omega = (2 * Math.PI) / cfg.response;
  const zeta = cfg.damping;

  // Reduced motion: honour the intent (a state change happened) without the
  // vestibular movement — jump to the target and report once.
  if (REDUCED.matches) {
    onFrame(target, 0);
    return { to: (next) => { target = next; onFrame(target, 0); }, stop: () => {}, get value() { return target; } };
  }

  let last = performance.now();
  const step = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 30); // clamp: never explode
    last = now;

    const displacement = x - target;
    const accel = -omega * omega * displacement - 2 * zeta * omega * v;
    v += accel * dt;
    x += v * dt;

    // Settled when both position and velocity are below perceptual threshold.
    if (Math.abs(x - target) < 0.05 && Math.abs(v) < 0.05) {
      x = target; v = 0; done = true;
      onFrame(x, v);
      return;
    }
    onFrame(x, v);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  return {
    /** Retarget in flight; position and velocity carry through. */
    to(next, nextOpts) {
      target = next;
      if (nextOpts && typeof nextOpts.velocity === 'number') v = nextOpts.velocity;
      if (done) { done = false; last = performance.now(); raf = requestAnimationFrame(step); }
    },
    stop() { cancelAnimationFrame(raf); },
    get value() { return x; },
    get velocity() { return v; },
  };
}

/**
 * Where a flick would come to rest, given its release velocity.
 *
 * This is the exponential-decay projection Apple ships (and that scroll views
 * use), not the textbook v^2/(2a). Snap targets are chosen from the PROJECTED
 * endpoint, which is what makes a flick feel like it throws the element rather
 * than dropping it at the finger.
 */
function project(velocity, decelerationRate) {
  const d = decelerationRate === undefined ? 0.998 : decelerationRate;
  return (velocity / 1000) * d / (1 - d);
}

/**
 * Progressive resistance past a boundary. A hard stop reads as frozen; damping
 * that grows with overshoot reads as responsive with nothing more to give.
 */
function rubberband(overshoot, dimension, constant) {
  const c = constant === undefined ? 0.55 : constant;
  return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
}

/**
 * Track a pointer with velocity history.
 *
 * Uses pointer capture so tracking survives the pointer leaving the element,
 * and records the grab offset so content stays glued to the exact point the
 * user took hold of — snapping to an element's centre breaks the illusion
 * immediately. Velocity comes from a short history rather than the last event,
 * which would be noisy at release.
 */
function track(el, handlers) {
  let history = [];
  let grabOffset = 0;
  let active = false;

  el.addEventListener('pointerdown', (e) => {
    active = true;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    grabOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    history = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    if (handlers.onStart) handlers.onStart(e, grabOffset);
  });

  el.addEventListener('pointermove', (e) => {
    if (!active) return;
    history.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    // Keep ~80ms of history: enough to smooth noise, short enough to be current.
    const cutoff = performance.now() - 80;
    while (history.length > 2 && history[0].t < cutoff) history.shift();
    if (handlers.onMove) handlers.onMove(e, grabOffset);
  });

  const release = (e) => {
    if (!active) return;
    active = false;
    const first = history[0], last = history[history.length - 1];
    const dt = Math.max((last.t - first.t) / 1000, 0.001);
    const velocity = { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
    if (handlers.onEnd) handlers.onEnd(e, velocity);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}
`;
