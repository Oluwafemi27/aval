import type { BindingSourceV01 } from "@pixel-point/aval-player-web";

import type {
  ElementOwnershipHandle,
  ElementOwnershipLedger
} from "./element-ownership-ledger.js";
import { EngagementController } from "./engagement-controller.js";
import { nextElementSequence } from "./element-sequence.js";

type AutomaticInputEvent =
  | "pointerenter"
  | "pointerleave"
  | "focusin"
  | "focusout"
  | "click";

interface InstalledInputListener {
  readonly type: AutomaticInputEvent;
  readonly listener: EventListener;
  readonly ownership: ElementOwnershipHandle;
}

interface InputAttachment {
  readonly token: number;
  readonly target: Element;
  readonly listeners: InstalledInputListener[];
  touchHoverSuppressed: boolean;
}

export class AutomaticInputs {
  readonly #route: (source: BindingSourceV01) => void;
  readonly #ledger: ElementOwnershipLedger;
  readonly #engagement: EngagementController;
  #target: Element | null = null;
  #attachment: InputAttachment | null = null;
  #attachmentToken = 0;
  #enabled = true;
  #metadataReady = false;
  #runtimeVisible = true;
  #disposed = false;

  public constructor(
    route: (source: BindingSourceV01) => void,
    ledger: ElementOwnershipLedger
  ) {
    this.#route = route;
    this.#ledger = ledger;
    this.#engagement = new EngagementController((source) => this.#emit(source));
  }

  public setTarget(target: Element | null): boolean {
    if (this.#disposed) return true;
    if (this.#target === target) {
      return target !== null && this.#enabled && this.#attachment === null
        ? this.#attach(target)
        : true;
    }
    let complete = this.#detach();
    this.#target = target;
    if (target !== null && this.#enabled) complete = this.#attach(target) && complete;
    if (this.#metadataReady) this.sample();
    return complete;
  }

  public setEnabled(enabled: boolean): boolean {
    if (this.#disposed) return true;
    if (enabled === this.#enabled) {
      return enabled && this.#target !== null && this.#attachment === null
        ? this.#attach(this.#target)
        : true;
    }
    this.#enabled = enabled;
    if (!enabled) return this.#detach();
    if (this.#target !== null) {
      const complete = this.#attach(this.#target);
      if (this.#metadataReady) this.sample();
      return complete;
    }
    return true;
  }

  public metadataReady(): void {
    if (this.#disposed) return;
    this.#metadataReady = true;
    this.sample();
  }

  public metadataUnready(): void {
    this.#metadataReady = false;
  }

  public setRuntimeVisible(visible: boolean): void {
    if (visible === this.#runtimeVisible) return;
    this.#runtimeVisible = visible;
    if (visible && this.#metadataReady) this.sample();
  }

  public sample(): void {
    const target = this.#target;
    if (
      !this.#metadataReady || !this.#enabled ||
      !this.#runtimeVisible || target === null
    ) return;
    let pointer = false;
    let focus = false;
    try {
      pointer = this.#attachment?.target === target &&
        !this.#attachment.touchHoverSuppressed && target.matches(":hover");
      const active = activeElementFor(target);
      focus = active !== null && (active === target || target.contains(active));
    } catch {
      // A hostile target sample is equivalent to no pointer/focus engagement.
    }
    this.#route(pointer ? "pointer.enter" : "pointer.leave");
    this.#route(focus ? "focus.in" : "focus.out");
    this.#engagement.sample(pointer, focus);
  }

  public dispose(): boolean {
    if (this.#disposed) return this.#ledger.snapshot().listenerCount === 0;
    this.#disposed = true;
    this.#detach();
    this.#target = null;
    this.#ledger.retryAll();
    return this.#ledger.snapshot().listenerCount === 0;
  }

  #attach(target: Element): boolean {
    if (this.#attachment !== null) return true;
    const attachment: InputAttachment = {
      token: this.#attachmentToken = nextElementSequence(
        this.#attachmentToken,
        "input attachment"
      ),
      target,
      listeners: [],
      touchHoverSuppressed: false
    };
    this.#attachment = attachment;
    for (const type of INPUT_EVENTS) {
      const listener: EventListener = (event) => {
        if (
          this.#disposed || !this.#enabled ||
          this.#attachment !== attachment ||
          attachment.token !== this.#attachmentToken
        ) return;
        this.#handle(attachment, type, event);
      };
      let ownership: ElementOwnershipHandle | null = null;
      try {
        ownership = this.#ledger.acquire("listener");
        target.addEventListener(type, listener);
        attachment.listeners.push({ type, listener, ownership });
      } catch {
        ownership?.release(() => target.removeEventListener(type, listener));
        this.#attachment = null;
        this.#attachmentToken = nextElementSequence(
          this.#attachmentToken,
          "input attachment"
        );
        let complete = true;
        for (const installed of attachment.listeners) {
          complete = installed.ownership.release(() => {
            target.removeEventListener(installed.type, installed.listener);
          }) && complete;
        }
        return false;
      }
    }
    return true;
  }

  #detach(): boolean {
    const attachment = this.#attachment;
    if (attachment === null) return true;
    this.#attachment = null;
    this.#attachmentToken = nextElementSequence(
      this.#attachmentToken,
      "input attachment"
    );
    let complete = true;
    for (const installed of attachment.listeners) {
      complete = installed.ownership.release(() => {
        attachment.target.removeEventListener(installed.type, installed.listener);
      }) && complete;
    }
    return complete;
  }

  #handle(
    attachment: InputAttachment,
    type: AutomaticInputEvent,
    event: Event
  ): void {
    switch (type) {
      case "pointerenter":
        if (isTouchPointer(event)) {
          attachment.touchHoverSuppressed = true;
          this.#engagement.setPointer(false);
          return;
        }
        attachment.touchHoverSuppressed = false;
        this.#emit("pointer.enter");
        this.#engagement.setPointer(true);
        return;
      case "pointerleave":
        if (isTouchPointer(event)) {
          attachment.touchHoverSuppressed = true;
          this.#engagement.setPointer(false);
          return;
        }
        attachment.touchHoverSuppressed = false;
        this.#emit("pointer.leave");
        this.#engagement.setPointer(false);
        return;
      case "focusin":
        this.#emit("focus.in");
        this.#engagement.setFocus(true);
        return;
      case "focusout": {
        const view = attachment.target.ownerDocument.defaultView;
        const next = view !== null && event instanceof view.FocusEvent
          ? event.relatedTarget
          : null;
        if (
          view !== null && next instanceof view.Node &&
          attachment.target.contains(next)
        ) return;
        this.#emit("focus.out");
        this.#engagement.setFocus(false);
        return;
      }
      case "click":
        this.#emit("activate");
    }
  }

  #emit(source: BindingSourceV01): void {
    if (
      this.#enabled && this.#metadataReady &&
      this.#runtimeVisible && !this.#disposed
    ) {
      this.#route(source);
    }
  }
}

const INPUT_EVENTS: readonly AutomaticInputEvent[] = Object.freeze([
  "pointerenter",
  "pointerleave",
  "focusin",
  "focusout",
  "click"
]);

function isTouchPointer(event: Event): boolean {
  const current = event.currentTarget as (EventTarget & {
    readonly ownerDocument?: Document;
  }) | null;
  const view = current?.ownerDocument?.defaultView ?? null;
  return view !== null &&
    typeof view.PointerEvent === "function" &&
    event instanceof view.PointerEvent &&
    event.pointerType === "touch";
}

function activeElementFor(target: Element): Element | null {
  const root = target.getRootNode();
  if ("activeElement" in root) {
    return (root as Document | ShadowRoot).activeElement;
  }
  return target.ownerDocument.activeElement;
}
