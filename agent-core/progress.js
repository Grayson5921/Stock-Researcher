// Progress-event sink. Replaces raw console logging in the workflow/monitor so a
// job can stream status to the UI (the worker persists each event per job).
//
// The worker calls setProgressSink(fn) before running a job and clearProgressSink()
// after. When no sink is set we fall back to console (used by the local dev CLI).
import { config } from "./config.js";

let sink = null;

export function setProgressSink(fn) {
  sink = fn;
}
export function clearProgressSink() {
  sink = null;
}

// Emit one progress event.
//   type    – category the UI can style: log | phase | verdict | news | sim |
//             stock | field | error | done
//   message – human-readable line (also what the CLI prints)
//   data    – optional structured payload for richer UI rendering
export function emit(type, message = "", data = undefined) {
  const evt = { type, message, at: new Date().toISOString() };
  if (data !== undefined) evt.data = data;
  if (sink) {
    try {
      sink(evt);
    } catch {
      /* a broken UI sink must never break a run */
    }
  } else if (config.VERBOSE && typeof message === "string") {
    console.log(message);
  }
  return evt;
}
