import type {
  AvalDiagnostics,
  AvalElement,
  AvalElementEventMap
} from "@aval/element";

import type { RouteLedger } from "./route-ledger.js";

export const PUBLIC_EVENT_NAMES = Object.freeze([
  "requestedstatechange",
  "transitionstart",
  "visualstatechange",
  "transitionend",
  "underflow",
  "fallback",
  "error"
] as const);

export function createPublicMotionElement(
  sourceUrl: string,
  parent: HTMLElement,
  routeLedger?: RouteLedger,
  integrity?: string
): AvalElement {
  const element = document.createElement("aval-player");
  element.className = "certification-motion";
  element.autoplay = "visible";
  element.motion = "full";
  element.src = sourceUrl;
  if (integrity !== undefined) element.integrity = integrity;
  const fallback = document.createElement("span");
  fallback.slot = "fallback";
  fallback.textContent = "Motion fallback";
  element.append(fallback);
  if (routeLedger !== undefined) attachRouteLedger(element, routeLedger);
  parent.append(element);
  return element;
}

export async function preparePublicMotion(
  element: AvalElement,
  timeoutMs = 20_000,
  signal?: AbortSignal
): Promise<Readonly<AvalDiagnostics>> {
  await waitForEffectiveVisibility(element, Math.min(timeoutMs, 2_000), signal);
  await element.prepare({ timeoutMs, ...(signal === undefined ? {} : { signal }) });
  let diagnostics = element.getDiagnostics({ trace: true });
  if (
    diagnostics.readiness === "staticReady" &&
    diagnostics.staticReason === "visibility-suspended" &&
    diagnostics.effectivelyVisible
  ) {
    diagnostics = await waitForVisibilityRecovery(
      element,
      Math.min(timeoutMs, 5_000),
      signal
    );
  }
  if (diagnostics.readiness !== "interactiveReady" && diagnostics.readiness !== "staticReady") {
    throw new Error(`unexpected public readiness ${diagnostics.readiness}`);
  }
  return diagnostics;
}

async function waitForVisibilityRecovery(
  element: AvalElement,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Readonly<AvalDiagnostics>> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    const diagnostics = element.getDiagnostics({ trace: true });
    if (
      diagnostics.readiness === "interactiveReady" ||
      diagnostics.staticReason !== "visibility-suspended"
    ) return diagnostics;
    if (performance.now() >= deadline) {
      throw new Error("public element visibility recovery did not settle before preparation");
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

async function waitForEffectiveVisibility(
  element: AvalElement,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    const rectangle = element.getBoundingClientRect();
    if (
      rectangle.width > 0 && rectangle.height > 0 &&
      element.getDiagnostics().effectivelyVisible
    ) return;
    if (performance.now() >= deadline) {
      throw new Error("public element did not become effectively visible before preparation");
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

export async function retirePublicMotion(element: AvalElement): Promise<Readonly<AvalDiagnostics>> {
  element.remove();
  await element.dispose();
  const diagnostics = element.getDiagnostics({ trace: true });
  if (!diagnostics.finalDisposed || diagnostics.readiness !== "disposed") {
    throw new Error("public element did not enter terminal disposal");
  }
  return diagnostics;
}

function attachRouteLedger(element: AvalElement, ledger: RouteLedger): void {
  for (const type of PUBLIC_EVENT_NAMES) {
    element.addEventListener(type, ((event: AvalElementEventMap[typeof type]) => {
      const detail = event.detail as unknown as Record<string, unknown>;
      ledger.append({
        event: type,
        timestampMicroseconds: nowMicroseconds(),
        generation: number(detail.generation),
        from: nullableText(detail.from),
        to: nullableText(detail.to),
        edge: nullableText(detail.edge),
        requestedState: element.requestedState,
        visualState: element.visualState,
        transitioning: element.isTransitioning
      });
    }) as EventListener);
  }
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 128) : null;
}

function number(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function nowMicroseconds(): number {
  return Math.max(0, Math.floor(performance.timeOrigin * 1_000 + performance.now() * 1_000));
}
