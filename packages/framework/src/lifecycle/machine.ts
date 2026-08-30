import { FrameworkError } from "../contracts/platform.js";

export type FrameworkState =
  | "created"
  | "resolving"
  | "verified"
  | "mounting"
  | "first-screen"
  | "interactive"
  | "updating"
  | "failed"
  | "disposed";

export interface FrameworkStateEvent {
  readonly from: FrameworkState;
  readonly state: FrameworkState;
  readonly reason?: string;
}

const transitions: Readonly<Record<FrameworkState, readonly FrameworkState[]>> =
  {
    created: ["resolving", "disposed"],
    resolving: ["verified", "failed", "disposed"],
    verified: ["mounting", "failed", "disposed"],
    mounting: ["first-screen", "failed", "disposed"],
    "first-screen": ["interactive", "failed", "disposed"],
    interactive: ["updating", "disposed", "failed"],
    updating: ["interactive", "failed", "disposed"],
    failed: ["resolving", "disposed"],
    disposed: [],
  };

export class LifecycleMachine {
  private currentState: FrameworkState = "created";

  private readonly listeners = new Set<(event: FrameworkStateEvent) => void>();

  public get state(): FrameworkState {
    return this.currentState;
  }

  public transition(
    state: FrameworkState,
    reason?: string,
  ): FrameworkStateEvent {
    if (!transitions[this.currentState].includes(state))
      throw new FrameworkError(
        "FRAMEWORK_INVALID_TRANSITION",
        "Cannot transition from " + this.currentState + " to " + state + ".",
        { from: this.currentState, state },
      );
    const event: FrameworkStateEvent = {
      from: this.currentState,
      state,
      ...(reason ? { reason } : {}),
    };
    this.currentState = state;
    for (const listener of this.listeners) listener(event);
    return event;
  }

  public subscribe(listener: (event: FrameworkStateEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
