// Fixed-step accumulator tick loop, decoupled from rAF.
// Phase 0: scaffold only — no-op ticks. Wired in so later phases plug their sim work in.

type TickFn = (dt: number, tick: number) => void;

interface TickLoop {
  start(): void;
  stop(): void;
  subscribe(fn: TickFn): () => void;
  get tick(): number;
}

interface TickLoopOptions {
  hz?: number;
  // Cap iterations per outer schedule call so a long pause doesn't cause a death-spiral.
  maxStepsPerSchedule?: number;
}

export function createTickLoop({
  hz = 30,
  maxStepsPerSchedule = 5,
}: TickLoopOptions = {}): TickLoop {
  const stepMs = 1000 / hz;
  const dt = 1 / hz;

  let running = false;
  let acc = 0;
  let last = 0;
  let tickCount = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const subs = new Set<TickFn>();

  const schedule = () => {
    timer = setTimeout(loop, stepMs);
  };

  const loop = () => {
    if (!running) return;
    const now = performance.now();
    acc += now - last;
    last = now;

    let steps = 0;
    while (acc >= stepMs && steps < maxStepsPerSchedule) {
      acc -= stepMs;
      steps += 1;
      tickCount += 1;
      for (const fn of subs) fn(dt, tickCount);
    }
    // Drop excessive backlog if we hit the cap (visible pause / tab unfocus).
    if (steps >= maxStepsPerSchedule) acc = 0;

    schedule();
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      acc = 0;
      schedule();
    },
    stop() {
      running = false;
      if (timer != null) clearTimeout(timer);
      timer = null;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    get tick() {
      return tickCount;
    },
  };
}
