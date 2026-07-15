import type { BindingSourceV01 } from "@pixel-point/aval-player-web";

import { AutomaticInputs } from "./automatic-inputs.js";
import { BindingRouter } from "./binding-router.js";
import type { ElementConfiguration } from "./element-configuration.js";
import type { ElementDesiredSnapshot } from "./element-desired-state.js";
import type { ElementOwnershipLedger } from "./element-ownership-ledger.js";
import { ElementRealmAutomation, type ElementRealmChange } from "./element-realm-automation.js";
import { resolveInteractionTarget } from "./interaction-target.js";

export type ElementAutomationSignal =
  | Readonly<{ type: "document"; visible: boolean; restored: boolean }>
  | Readonly<{ type: "intersection"; intersecting: boolean }>
  | Readonly<{ type: "observer"; supported: boolean }>
  | Readonly<{ type: "box"; width: number; height: number }>
  | Readonly<{ type: "dpr"; value: number }>
  | Readonly<{ type: "motion"; value: boolean | null }>
  | Readonly<{ type: "unsupported" }>;

export interface ElementAutomationAuthority {
  automationSignal(signal: ElementAutomationSignal): void;
  automaticInput(source: BindingSourceV01): void;
  send(event: string): boolean;
}

export interface ElementInteractionResult {
  readonly complete: boolean;
  readonly reportMissing: boolean;
}

/** Concrete owner for realm/input mechanisms; it never schedules runtime effects. */
export class ElementHostAutomation {
  public readonly router: BindingRouter;
  public readonly inputs: AutomaticInputs;
  readonly #host: HTMLElement;
  readonly #ledger: ElementOwnershipLedger;
  readonly #realm: ElementRealmAutomation;
  #active = false;
  #interactionFailureKey: string | null = null;

  public constructor(input: Readonly<{
    host: HTMLElement;
    ledger: ElementOwnershipLedger;
    authority: ElementAutomationAuthority;
  }>) {
    this.#host = input.host;
    this.#ledger = input.ledger;
    this.router = new BindingRouter((event) => input.authority.send(event));
    this.inputs = new AutomaticInputs(
      (source) => input.authority.automaticInput(source),
      input.ledger
    );
    const publish = (signal: ElementAutomationSignal): void => {
      input.authority.automationSignal(signal);
    };
    this.#realm = new ElementRealmAutomation({
      host: input.host,
      ledger: input.ledger,
      onDocumentVisible: (visible, restored) => publish({
        type: "document", visible, restored
      }),
      onIntersection: (intersecting) => publish({ type: "intersection", intersecting }),
      onObserverSupported: (supported) => publish({ type: "observer", supported }),
      onBox: ({ width, height }) => publish({ type: "box", width, height }),
      onDpr: (value) => publish({ type: "dpr", value }),
      onHostReduced: (value) => publish({ type: "motion", value }),
      onUnsupported: () => publish({ type: "unsupported" })
    });
  }

  public get active(): boolean { return this.#active; }
  public enterCurrentRealm(): Readonly<ElementRealmChange> {
    return this.#realm.enterCurrentRealm();
  }
  public start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#realm.start();
  }
  public stop(): boolean {
    if (!this.#active) return this.#ledger.retryAll();
    this.#active = false;
    return this.#realm.stop();
  }
  public configureMotion(value: Readonly<ElementConfiguration>["motion"]): boolean {
    return this.#realm.configureMotion(value);
  }

  public interaction(
    snapshot: Readonly<ElementDesiredSnapshot>,
    configuration: Readonly<ElementConfiguration>
  ): Readonly<ElementInteractionResult> {
    const enabled = configuration.bindings === "auto";
    this.router.setEnabled(enabled);
    let complete = this.inputs.setEnabled(enabled);
    let target: Element | null = null;
    try {
      target = resolveInteractionTarget({
        host: this.#host,
        override: snapshot.interactionTarget,
        id: configuration.interactionFor
      });
    } catch { target = null; }
    complete = this.inputs.setTarget(target) && complete;
    const missing = target === null && configuration.interactionFor !== "";
    const key = missing
      ? `${snapshot.sourceToken}:${configuration.interactionFor}`
      : null;
    const reportMissing = key !== null && key !== this.#interactionFailureKey;
    this.#interactionFailureKey = key;
    return Object.freeze({ complete, reportMissing });
  }

  public dispose(): boolean {
    let complete = attempt(() => this.stop());
    complete = attempt(() => this.inputs.dispose()) && complete;
    complete = attempt(() => this.#realm.dispose()) && complete;
    complete = attempt(() => this.#ledger.retryAll()) && complete;
    return complete;
  }
}

function attempt(operation: () => boolean): boolean {
  try { return operation(); }
  catch { return false; }
}
