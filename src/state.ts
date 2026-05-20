// State machine for a single embed.
//
// The transition table mirrors the doc spec verbatim. Any transition not listed
// is rejected — we'd rather log a warning than silently allow bad sequences.

export type State =
  | "idle"
  | "requesting_mic"
  | "mic_denied"
  | "connecting"
  | "active"
  | "ending"
  | "ended"
  | "error";

export type Event =
  | "click"
  | "mic_granted"
  | "mic_failed"
  | "ws_open_and_started"
  | "ws_failed"
  | "hangup"
  | "ws_closed"
  | "retry"
  | "reset";

type TransitionTable = Readonly<Record<State, Readonly<Partial<Record<Event, State>>>>>;

const TRANSITIONS: TransitionTable = {
  idle: { click: "requesting_mic" },
  requesting_mic: { mic_granted: "connecting", mic_failed: "mic_denied" },
  mic_denied: { retry: "requesting_mic" },
  connecting: { ws_open_and_started: "active", ws_failed: "error" },
  active: { hangup: "ending" },
  ending: { ws_closed: "ended" },
  ended: { reset: "idle" },
  error: { retry: "idle" },
};

export type Listener = (next: State, prev: State) => void;

export class StateMachine {
  private current: State = "idle";
  private readonly listeners = new Set<Listener>();

  get state(): State {
    return this.current;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Apply an event. Returns the new state, or null if the event was not valid
   * from the current state. Invalid transitions are dropped — callers that
   * care can check the return value.
   */
  send(event: Event): State | null {
    const allowed = TRANSITIONS[this.current];
    const next = allowed[event];
    if (!next) {
      return null;
    }
    const prev = this.current;
    this.current = next;
    for (const fn of this.listeners) {
      fn(next, prev);
    }
    return next;
  }

  /** For tests only. */
  _force(state: State): void {
    this.current = state;
  }
}
