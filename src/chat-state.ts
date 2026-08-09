// State machine for a single chat embed. Deliberately NOT the same states as
// the voice widget's `state.ts`: there is no getUserMedia step for text
// chat, so there is no requesting_mic/mic_denied, and no "ending"
// transitional state — a stop or end_call goes straight from active to
// ended (there's no WebRTC teardown to wait on).
//
// idle
//  └ activate → connecting
//               ├ ready       → active
//               │               ├ stop        → ended   (visitor closes the panel)
//               │               └ server_end  → ended   ({"type":"end_call"} from server)
//               ├ ws_failed   → error
//               └ stop        → idle           (visitor cancels before the session ever started)
// ended  └ activate → connecting (restart) | reset → idle (dismiss)
// error  └ activate → connecting (retry)   | reset → idle (dismiss)

export type ChatState = "idle" | "connecting" | "active" | "ended" | "error";

export type ChatEvent =
  | "activate" // launcher clicked from idle, or restart/retry clicked from ended/error
  | "ready" // server sent {"type":"ready"}
  | "ws_failed" // token request failed, socket construction failed, fatal error, or unexpected close
  | "stop" // visitor closed the panel
  | "server_end" // server sent {"type":"end_call"}
  | "reset"; // visitor dismissed the ended/error panel back to the launcher

type TransitionTable = Readonly<Record<ChatState, Readonly<Partial<Record<ChatEvent, ChatState>>>>>;

const TRANSITIONS: TransitionTable = {
  idle: { activate: "connecting" },
  connecting: { ready: "active", ws_failed: "error", stop: "idle" },
  active: { stop: "ended", server_end: "ended", ws_failed: "error" },
  ended: { activate: "connecting", reset: "idle" },
  error: { activate: "connecting", reset: "idle" },
};

export type ChatListener = (next: ChatState, prev: ChatState) => void;

export class ChatStateMachine {
  private current: ChatState = "idle";
  private readonly listeners = new Set<ChatListener>();

  get state(): ChatState {
    return this.current;
  }

  on(fn: ChatListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Apply an event. Returns the new state, or null if the event was not
   * valid from the current state. Invalid transitions are dropped.
   */
  send(event: ChatEvent): ChatState | null {
    const allowed = TRANSITIONS[this.current];
    const next = allowed[event];
    if (!next) return null;
    const prev = this.current;
    this.current = next;
    for (const fn of this.listeners) fn(next, prev);
    return next;
  }

  /** For tests + defensive fallbacks only. */
  _force(state: ChatState): void {
    this.current = state;
  }
}
