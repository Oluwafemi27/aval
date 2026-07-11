import { MotionGraphError } from "./errors.js";
import type {
  GraphEdgeDefinition,
  GraphPresentation,
  GraphStateDefinition,
  GraphStateId,
  MotionGraphDefinition,
  MotionGraphEffect,
  MotionGraphOperation,
  MotionGraphReadiness,
  MotionGraphResult,
  MotionGraphSnapshot,
  MotionGraphTickOptions,
  MotionGraphTraceRecord,
  ValidatedMotionGraph
} from "./model.js";
import {
  OperationJournal,
  type OperationResultMetadata
} from "./operation-journal.js";
import {
  planEventIntent,
  planStateIntent,
  type EventIntentPlan,
  type IntentContext,
  type StateIntentPlan
} from "./intent-router.js";
import {
  findFinishBoundary,
  findNextPortalBoundary,
  nextBodyFrame
} from "./portal-search.js";
import { RequestLedger, type RequestAdmission } from "./request-ledger.js";
import { RoutePlan, type SequencedEdge } from "./route-plan.js";
import {
  getValidatedGraphIndexes,
  validateMotionGraphDefinition,
  type ValidatedGraphIndexes
} from "./validate.js";

/**
 * Pure version-0 graph reducer. It owns authored cursors and emits abstract
 * presentations/effects; hosts own promises, clocks, codecs, and rendering.
 */
export class MotionGraphEngine {
  #graph: ValidatedMotionGraph | null = null;
  #indexes: ValidatedGraphIndexes | null = null;
  readonly #ledger = new RequestLedger();
  readonly #journal = new OperationJournal();
  readonly #routes = new RoutePlan();

  #readiness: MotionGraphReadiness = "unready";
  #phase: MotionGraphSnapshot["phase"] = "unready";
  #requestedState: GraphStateId | null = null;
  #visualState: GraphStateId | null = null;
  #presentation: Readonly<GraphPresentation> | null = null;

  public install(
    definition: MotionGraphDefinition | ValidatedMotionGraph
  ): Readonly<MotionGraphResult> {
    if (this.#readiness !== "unready") {
      throw new MotionGraphError(
        "GRAPH_VALIDATION",
        "graph metadata can only be installed once"
      );
    }
    const graph = isValidatedGraph(definition)
      ? definition
      : validateMotionGraphDefinition(definition);
    this.#graph = graph;
    this.#indexes = getValidatedGraphIndexes(graph);
    const initial = graph.definition.initialState;
    const state = this.#state(initial);
    this.#requestedState = initial;
    this.#visualState = initial;
    this.#presentation = freezePresentation({
      kind: "static",
      state: initial,
      staticFrameId: state.staticFrameId
    });
    const effects: MotionGraphEffect[] = [];
    this.#changeReadiness("preparing", effects);
    this.#phase = "preparing";
    return this.#result("install", effects);
  }

  public beginAnimated(): Readonly<MotionGraphResult> {
    this.#assertPhase("preparing", "beginAnimated");
    const effects: MotionGraphEffect[] = [];
    this.#changeReadiness("animated", effects);
    const initial = this.#definition().initialState;
    const state = this.#state(initial);

    if (this.#requestedState === initial && state.initialUnit !== undefined) {
      this.#phase = "intro";
      this.#presentation = freezePresentation({
        kind: "intro",
        state: initial,
        unitId: state.initialUnit.unitId,
        frameIndex: 0
      });
    } else {
      this.#presentation = this.#bodyPresentation(initial, 0);
      this.#phase = this.#routes.pending === null ? "stable" : "waiting";
    }
    return this.#result("begin-animated", effects);
  }

  public beginStatic(reason: string): Readonly<MotionGraphResult> {
    this.#assertPhase("preparing", "beginStatic");
    const effects: MotionGraphEffect[] = [];
    this.#changeReadiness("static", effects, reason);
    effects.push(freezeEffect({ type: "fallback", reason }));
    this.#phase = "static";

    const visual = this.#requireVisualState();
    const requested = this.#requireRequestedState();
    if (visual !== requested) {
      const edge = this.#edgeDirect(visual, requested);
      if (edge === null) {
        throw new MotionGraphError(
          "ROUTE_NOT_FOUND",
          `prepared target ${requested} has no direct route from ${visual}`
        );
      }
      this.#commitStaticEdge(
        edge,
        this.#routes.pending?.sequence ?? this.#journal.inputSequence,
        effects,
        true
      );
    } else {
      this.#presentation = this.#staticPresentation(visual);
      this.#routes.clear();
    }
    return this.#result("begin-static", effects);
  }

  public recoverStatic(reason: string): Readonly<MotionGraphResult> {
    this.#assertInstalled("recoverStatic");
    if (this.#readiness === "disposed" || this.#readiness === "error") {
      throw new MotionGraphError("DISPOSED", "graph cannot recover after termination");
    }
    const effects: MotionGraphEffect[] = [];
    this.#changeReadiness("static", effects, reason);
    effects.push(freezeEffect({ type: "fallback", reason }));
    const visual = this.#requireVisualState();
    const requested = this.#requireRequestedState();

    if (visual !== requested || this.#routes.hasRoute()) {
      const recovery = this.#routes.recoveryCandidate();
      const edge = recovery?.edge ?? this.#edgeDirect(visual, requested);
      if (edge !== null) {
        const hadStarted = this.#routes.active?.edge.id === edge.id;
        if (!hadStarted) {
          effects.push(
            this.#transitionStart(
              edge,
              recovery?.sequence ?? this.#journal.inputSequence
            )
          );
        }
        this.#presentation = this.#staticPresentation(requested);
        this.#setVisualState(requested, effects);
        effects.push(this.#transitionEnd(edge));
      } else {
        this.#presentation = this.#staticPresentation(requested);
        this.#setVisualState(requested, effects);
      }
      const settlement = this.#ledger.settlePending({
        type: "resolve",
        timing: "microtask",
        reason: "static-recovery"
      });
      if (settlement !== null) {
        effects.push(settlement);
      }
    } else {
      this.#presentation = this.#staticPresentation(visual);
    }
    this.#routes.clear();
    this.#phase = "static";
    return this.#result("recover-static", effects);
  }

  public failStatic(message = "static fallback could not be installed"):
    Readonly<MotionGraphResult> {
    this.#assertInstalled("failStatic");
    if (this.#readiness === "disposed") {
      throw new MotionGraphError("DISPOSED", "disposed graph cannot fail static");
    }
    const effects: MotionGraphEffect[] = [];
    this.#changeReadiness("error", effects, message);
    const settlement = this.#ledger.settlePending({
      type: "reject",
      timing: "microtask",
      error: "PlaybackFallbackError"
    });
    if (settlement !== null) {
      effects.push(settlement);
    }
    this.#routes.clear();
    this.#phase = "error";
    return this.#result("fail-static", effects);
  }

  public request(target: GraphStateId): Readonly<MotionGraphResult> {
    const input = this.#journal.beginInput();
    if (!input.withinLimit) {
      const standalone = this.#ledger.settleNew({
        type: "reject",
        timing: "microtask",
        error: "InputOverflowError"
      });
      return this.#result("request", [standalone.effect], {
        accepted: false,
        joined: false,
        sequence: input.sequence,
        requestId: standalone.requestId
      });
    }

    if (this.#readiness === "unready") {
      return this.#rejectedRequest(target, input.sequence, "NotReadyError");
    }
    if (this.#readiness === "disposed" || this.#readiness === "error") {
      return this.#rejectedRequest(target, input.sequence, "AbortError");
    }
    if (!this.#hasState(target)) {
      return this.#rejectedRequest(target, input.sequence, "RouteError");
    }

    return this.#applyStateIntent(
      planStateIntent(this.#intentContext(), target),
      target,
      input.sequence
    );
  }

  public send(event: string): Readonly<MotionGraphResult> {
    const input = this.#journal.beginInput();
    if (!input.withinLimit || this.#readiness === "unready") {
      return this.#result("send", [], {
        accepted: false,
        sequence: input.sequence
      });
    }
    if (this.#readiness === "disposed" || this.#readiness === "error") {
      return this.#result("send", [], {
        accepted: false,
        sequence: input.sequence
      });
    }

    const plan = planEventIntent(this.#intentContext(), event);
    if (plan.kind === "reject") {
      return this.#result("send", [], {
        accepted: false,
        sequence: input.sequence
      });
    }
    const effects: MotionGraphEffect[] = [];
    this.#applyEventIntent(plan, input.sequence, effects);
    return this.#result("send", effects, {
      accepted: true,
      sequence: input.sequence
    });
  }

  public tick(options: MotionGraphTickOptions): Readonly<MotionGraphResult> {
    this.#assertInstalled("tick");
    if (this.#readiness === "disposed" || this.#readiness === "error") {
      throw new MotionGraphError("DISPOSED", "terminated graph cannot tick");
    }
    this.#journal.beginTick(options.contentOrdinal);
    const effects: MotionGraphEffect[] = [];
    const routeReady = options.routeReady ?? true;

    switch (this.#phase) {
      case "preparing":
      case "static":
        break;
      case "intro":
        this.#tickIntro();
        break;
      case "stable":
        this.#tickStable(routeReady, effects);
        break;
      case "waiting":
        this.#tickWaiting(routeReady, effects);
        break;
      case "locked":
        this.#tickLocked(effects);
        break;
      case "reversible":
        this.#tickReversible(effects);
        break;
      case "unready":
      case "disposed":
      case "error":
        throw new MotionGraphError("NOT_READY", "graph is not tickable");
    }
    this.#journal.completeTick();
    return this.#result("tick", effects);
  }

  public dispose(): Readonly<MotionGraphResult> {
    if (this.#readiness === "disposed") {
      return this.#result("dispose", []);
    }
    const effects: MotionGraphEffect[] = [];
    const settlement = this.#ledger.settlePending({
      type: "reject",
      timing: "microtask",
      error: "AbortError"
    });
    if (settlement !== null) {
      effects.push(settlement);
    }
    this.#changeReadiness("disposed", effects);
    this.#phase = "disposed";
    this.#presentation = null;
    this.#routes.clear();
    return this.#result("dispose", effects);
  }

  public snapshot(): Readonly<MotionGraphSnapshot> {
    return Object.freeze({
      readiness: this.#readiness,
      phase: this.#phase,
      requestedState: this.#requestedState,
      visualState: this.#visualState,
      prospectiveState: this.#routes.prospectiveState(this.#visualState),
      isTransitioning: this.#isTransitioning(),
      presentation: this.#presentation,
      pendingEdgeId: this.#routes.pending?.edge.id ?? null,
      activeEdgeId: this.#routes.active?.edge.id ?? null,
      followOnEdgeId: this.#routes.followOn?.edge.id ?? null,
      direction:
        this.#presentation?.kind === "reversible"
          ? this.#presentation.direction
          : null,
      contentOrdinal: this.#journal.contentOrdinal,
      inputSequence: this.#journal.inputSequence,
      pendingRequestCount: this.#ledger.pendingRequestCount,
      inputsSinceTick: this.#journal.inputsSinceTick,
      routeOperationsLastTick: this.#journal.routeOperationsLastTick
    });
  }

  public getTrace(): readonly Readonly<MotionGraphTraceRecord>[] {
    return this.#journal.getTrace();
  }

  #applyStateIntent(
    plan: Readonly<StateIntentPlan>,
    target: GraphStateId,
    sequence: number
  ): Readonly<MotionGraphResult> {
    if (plan.kind === "reject") {
      return this.#rejectedRequest(target, sequence, "RouteError");
    }
    if (plan.kind === "standalone-noop") return this.#noopRequest(sequence);

    const effects: MotionGraphEffect[] = [];
    const admission = this.#ledger.request(target);
    if (plan.kind === "join-pending") {
      return this.#acceptedRequest(admission, sequence, effects);
    }

    this.#setRequestedState(target, sequence, effects);
    this.#appendSuperseded(admission, effects);

    if (plan.kind === "cancel-before-stable" || plan.kind === "cancel-pending") {
      this.#routes.cancelPending();
      if (plan.kind === "cancel-pending") this.#phase = "stable";
      const settled = this.#ledger.settlePending({
        type: "resolve",
        timing: "microtask",
        reason: "stable-noop"
      });
      if (settled !== null) effects.push(settled);
      return this.#acceptedRequest(admission, sequence, effects, false);
    }

    switch (plan.kind) {
      case "replace-pending":
        this.#routes.replacePending(plan.edge, sequence);
        if (this.#phase !== "preparing" && this.#phase !== "intro") {
          this.#phase = "waiting";
        }
        break;
      case "continue-active-target":
        this.#routes.clearFollowOn();
        this.#routes.clearReversal();
        break;
      case "continue-reversal-target":
        this.#routes.clearFollowOn();
        break;
      case "queue-reversal":
        this.#routes.queueReversal(plan.edge, sequence);
        break;
      case "queue-follow-on":
        this.#routes.queueFollowOn(plan.edge, sequence);
        break;
      case "static-commit":
        this.#commitStaticEdge(plan.edge, sequence, effects, false);
        break;
    }
    return this.#acceptedRequest(admission, sequence, effects);
  }

  #applyEventIntent(
    plan: Exclude<Readonly<EventIntentPlan>, { readonly kind: "reject" }>,
    sequence: number,
    effects: MotionGraphEffect[]
  ): void {
    if (plan.kind === "accept-noop") return;

    if (plan.kind === "cancel-pending") {
      this.#setRequestedState(plan.edge.to, sequence, effects);
      this.#abortPendingForEvent(effects);
      this.#routes.cancelPending();
      if (this.#phase === "waiting") this.#phase = "stable";
      return;
    }

    this.#setRequestedState(plan.edge.to, sequence, effects);
    this.#abortPendingForEvent(effects);
    switch (plan.kind) {
      case "replace-pending":
        this.#routes.replacePending(plan.edge, sequence);
        if (this.#phase !== "preparing" && this.#phase !== "intro") {
          this.#phase = "waiting";
        }
        break;
      case "continue-active-target":
        this.#routes.clearFollowOn();
        this.#routes.clearReversal();
        break;
      case "queue-reversal":
        this.#routes.queueReversal(plan.edge, sequence);
        break;
      case "queue-follow-on":
        this.#routes.queueFollowOn(plan.edge, sequence);
        break;
      case "static-commit":
        this.#commitStaticEdge(plan.edge, sequence, effects, false);
        break;
    }
  }

  #acceptedRequest(
    admission: Readonly<RequestAdmission>,
    sequence: number,
    effects: readonly MotionGraphEffect[],
    joined = admission.joined
  ): Readonly<MotionGraphResult> {
    return this.#result("request", effects, {
      accepted: true,
      joined,
      sequence,
      requestId: admission.requestId
    });
  }

  #intentContext(): Readonly<IntentContext> {
    const phase = this.#phase;
    if (phase === "unready" || phase === "disposed" || phase === "error") {
      throw new Error(`phase ${phase} cannot route intent`);
    }
    return Object.freeze({
      phase,
      visualState: this.#requireVisualState(),
      routes: this.#routes,
      indexes: this.#indexesOrThrow(),
      hasPendingRequests: this.#ledger.pendingRequestCount > 0
    });
  }

  #tickIntro(): void {
    const presentation = this.#presentation;
    if (presentation?.kind !== "intro") {
      throw new Error("intro phase has no intro presentation");
    }
    const state = this.#state(presentation.state);
    const initial = state.initialUnit;
    if (initial === undefined) throw new Error("intro state has no initial unit");
    if (presentation.frameIndex + 1 < initial.frameCount) {
      this.#presentation = freezePresentation({
        ...presentation,
        frameIndex: presentation.frameIndex + 1
      });
      return;
    }
    this.#presentation = this.#bodyPresentation(state.id, 0);
    this.#phase = this.#routes.pending === null ? "stable" : "waiting";
  }

  #tickStable(routeReady: boolean, effects: MotionGraphEffect[]): void {
    const presentation = this.#bodyPresentationOrThrow();
    const completion = this.#indexesOrThrow().completionEdgesByState.get(
      presentation.state
    );
    const state = this.#state(presentation.state);
    if (
      completion !== undefined &&
      presentation.frameIndex === state.body.frameCount - 1 &&
      (routeReady || completion.start.type === "cut")
    ) {
      const sequence = this.#journal.allocateInternalSequence();
      this.#setRequestedState(completion.to, sequence, effects);
      this.#journal.incrementRouteOperations();
      this.#startEdge(completion, sequence, effects);
      return;
    }
    const next = nextBodyFrame(state.body, presentation.frameIndex);
    this.#presentation = this.#bodyPresentation(state.id, next.frameIndex);
  }

  #tickWaiting(routeReady: boolean, effects: MotionGraphEffect[]): void {
    const pending = this.#requirePendingRoute();
    const edge = pending.edge;
    const presentation = this.#bodyPresentationOrThrow();
    const state = this.#state(presentation.state);
    if (edge.from !== state.id) {
      throw new Error("pending edge source does not match body presentation");
    }

    if (edge.start.type === "cut") {
      this.#journal.incrementRouteOperations();
      this.#startEdge(edge, pending.sequence, effects);
      return;
    }

    const boundary = edge.start.type === "portal"
      ? findNextPortalBoundary(
          state.body,
          edge.start.sourcePort,
          presentation.frameIndex
        )
      : findFinishBoundary(state.body, presentation.frameIndex);

    if (boundary.eligibleNow && routeReady) {
      this.#journal.incrementRouteOperations();
      this.#startEdge(edge, pending.sequence, effects);
      return;
    }

    const next = nextBodyFrame(state.body, presentation.frameIndex);
    this.#presentation = this.#bodyPresentation(state.id, next.frameIndex);
  }

  #tickLocked(effects: MotionGraphEffect[]): void {
    const edge = this.#requireActiveRoute().edge;
    const transition = edge.transition;
    const presentation = this.#presentation;
    if (transition?.kind !== "locked" || presentation?.kind !== "locked") {
      throw new Error("locked phase has inconsistent transition state");
    }
    if (presentation.frameIndex + 1 < transition.frameCount) {
      this.#presentation = freezePresentation({
        ...presentation,
        frameIndex: presentation.frameIndex + 1
      });
      return;
    }
    this.#commitActiveEdge(edge, effects);
  }

  #tickReversible(effects: MotionGraphEffect[]): void {
    let active = this.#requireActiveRoute();
    let edge = active.edge;
    const presentation = this.#presentation;
    if (presentation?.kind !== "reversible") {
      throw new Error("reversible phase has no reversible presentation");
    }

    if (this.#routes.reversal !== null) {
      active = this.#routes.activateReversal();
      edge = active.edge;
      effects.push(this.#transitionStart(edge, active.sequence));
    }

    const transition = edge.transition;
    if (transition?.kind !== "reversible") {
      throw new Error("active reversible edge has no reversible transition");
    }
    const next = transition.direction === "forward"
      ? presentation.frameIndex + 1
      : presentation.frameIndex - 1;
    if (next < 0 || next >= transition.frameCount) {
      this.#commitActiveEdge(edge, effects);
      return;
    }
    this.#presentation = freezePresentation({
      kind: "reversible",
      edgeId: edge.id,
      unitId: transition.unitId,
      frameIndex: next,
      direction: transition.direction
    });
  }

  #startEdge(
    edge: GraphEdgeDefinition,
    sequence: number,
    effects: MotionGraphEffect[]
  ): void {
    this.#routes.activate(edge, sequence);
    effects.push(this.#transitionStart(edge, sequence));
    const transition = edge.transition;
    if (transition === undefined) {
      this.#commitActiveEdge(edge, effects);
      return;
    }
    if (transition.kind === "locked") {
      this.#phase = "locked";
      this.#presentation = freezePresentation({
        kind: "locked",
        edgeId: edge.id,
        unitId: transition.unitId,
        frameIndex: 0
      });
      return;
    }
    this.#phase = "reversible";
    this.#presentation = freezePresentation({
      kind: "reversible",
      edgeId: edge.id,
      unitId: transition.unitId,
      frameIndex:
        transition.direction === "forward" ? 0 : transition.frameCount - 1,
      direction: transition.direction
    });
  }

  #commitActiveEdge(
    edge: GraphEdgeDefinition,
    effects: MotionGraphEffect[]
  ): void {
    this.#presentation = this.#bodyPresentation(edge.to, 0);
    this.#setVisualState(edge.to, effects);
    effects.push(this.#transitionEnd(edge));
    const completion = this.#routes.completeActive();

    if (completion.promoted !== null) {
      this.#phase = "waiting";
      return;
    }

    this.#phase = "stable";
    if (this.#requestedState === this.#visualState) {
      const settlement = this.#ledger.settlePending({
        type: "resolve",
        timing: "microtask",
        reason: "target-committed"
      });
      if (settlement !== null) effects.push(settlement);
    }
  }

  #commitStaticEdge(
    edge: GraphEdgeDefinition,
    sequence: number,
    effects: MotionGraphEffect[],
    preparationCommit: boolean
  ): void {
    effects.push(this.#transitionStart(edge, sequence));
    this.#presentation = this.#staticPresentation(edge.to);
    this.#setVisualState(edge.to, effects);
    effects.push(this.#transitionEnd(edge));
    const settlement = this.#ledger.settlePending({
      type: "resolve",
      timing: "microtask",
      reason: preparationCommit ? "static-recovery" : "target-committed"
    });
    if (settlement !== null) effects.push(settlement);
    this.#routes.clear();
    this.#phase = "static";
  }

  #setRequestedState(
    target: GraphStateId,
    sequence: number,
    effects: MotionGraphEffect[]
  ): void {
    const previous = this.#requireRequestedState();
    if (previous === target) return;
    this.#requestedState = target;
    effects.push(freezeEffect({
      type: "requestedstatechange",
      from: previous,
      to: target,
      sequence
    }));
  }

  #setVisualState(
    target: GraphStateId,
    effects: MotionGraphEffect[]
  ): void {
    const previous = this.#requireVisualState();
    if (previous === target) return;
    this.#visualState = target;
    effects.push(freezeEffect({
      type: "visualstatechange",
      from: previous,
      to: target
    }));
  }

  #transitionStart(
    edge: GraphEdgeDefinition,
    sequence: number
  ): Readonly<MotionGraphEffect> {
    return freezeEffect({
      type: "transitionstart",
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      sequence
    });
  }

  #transitionEnd(edge: GraphEdgeDefinition): Readonly<MotionGraphEffect> {
    return freezeEffect({
      type: "transitionend",
      edgeId: edge.id,
      from: edge.from,
      to: edge.to
    });
  }

  #noopRequest(sequence: number): Readonly<MotionGraphResult> {
    const standalone = this.#ledger.settleNew({
      type: "resolve",
      timing: "microtask",
      reason: "stable-noop"
    });
    return this.#result("request", [standalone.effect], {
      accepted: true,
      joined: false,
      sequence,
      requestId: standalone.requestId
    });
  }

  #rejectedRequest(
    _target: GraphStateId,
    sequence: number,
    error: "NotReadyError" | "RouteError" | "AbortError"
  ): Readonly<MotionGraphResult> {
    const standalone = this.#ledger.settleNew({
      type: "reject",
      timing: "microtask",
      error
    });
    return this.#result("request", [standalone.effect], {
      accepted: false,
      joined: false,
      sequence,
      requestId: standalone.requestId
    });
  }

  #appendSuperseded(
    admission: Readonly<RequestAdmission>,
    effects: MotionGraphEffect[]
  ): void {
    if (admission.superseded !== null) effects.push(admission.superseded);
  }

  #abortPendingForEvent(effects: MotionGraphEffect[]): void {
    const settlement = this.#ledger.settlePending({
      type: "reject",
      timing: "microtask",
      error: "AbortError"
    });
    if (settlement !== null) effects.push(settlement);
  }

  #changeReadiness(
    next: MotionGraphReadiness,
    effects: MotionGraphEffect[],
    reason?: string
  ): void {
    const previous = this.#readiness;
    if (previous === next) return;
    this.#readiness = next;
    effects.push(freezeEffect({
      type: "readinesschange",
      from: previous,
      to: next,
      ...(reason === undefined ? {} : { reason })
    }));
  }

  #result(
    operation: MotionGraphOperation,
    effects: readonly MotionGraphEffect[],
    metadata: OperationResultMetadata = {}
  ): Readonly<MotionGraphResult> {
    return this.#journal.record({
      operation,
      metadata,
      presentation: this.#presentation,
      effects,
      snapshot: this.snapshot()
    });
  }

  #isTransitioning(): boolean {
    return (
      this.#phase === "waiting" ||
      this.#phase === "locked" ||
      this.#phase === "reversible" ||
      this.#requestedState !== this.#visualState
    );
  }

  #bodyPresentation(
    stateId: GraphStateId,
    frameIndex: number
  ): Readonly<GraphPresentation> {
    const state = this.#state(stateId);
    return freezePresentation({
      kind: "body",
      state: stateId,
      unitId: state.body.unitId,
      frameIndex
    });
  }

  #staticPresentation(stateId: GraphStateId): Readonly<GraphPresentation> {
    const state = this.#state(stateId);
    return freezePresentation({
      kind: "static",
      state: stateId,
      staticFrameId: state.staticFrameId
    });
  }

  #bodyPresentationOrThrow(): Extract<GraphPresentation, { kind: "body" }> {
    if (this.#presentation?.kind !== "body") {
      throw new Error("graph phase requires a body presentation");
    }
    return this.#presentation;
  }

  #requirePendingRoute(): Readonly<SequencedEdge> {
    const pending = this.#routes.pending;
    if (pending === null) throw new Error("graph has no pending edge");
    return pending;
  }

  #requireActiveRoute(): Readonly<SequencedEdge> {
    const active = this.#routes.active;
    if (active === null) throw new Error("graph has no active edge");
    return active;
  }

  #edgeDirect(from: GraphStateId, to: GraphStateId): GraphEdgeDefinition | null {
    return this.#indexesOrThrow().directEdgesByState.get(from)?.get(to) ?? null;
  }

  #state(id: GraphStateId): GraphStateDefinition {
    const state = this.#indexesOrThrow().statesById.get(id);
    if (state === undefined) throw new Error(`validated graph has no state ${id}`);
    return state;
  }

  #hasState(id: GraphStateId): boolean {
    return this.#indexesOrThrow().statesById.has(id);
  }

  #definition(): Readonly<MotionGraphDefinition> {
    if (this.#graph === null) throw new Error("graph metadata is unavailable");
    return this.#graph.definition;
  }

  #indexesOrThrow(): ValidatedGraphIndexes {
    if (this.#indexes === null) throw new Error("graph indexes are unavailable");
    return this.#indexes;
  }

  #requireVisualState(): GraphStateId {
    if (this.#visualState === null) throw new Error("visual state is unavailable");
    return this.#visualState;
  }

  #requireRequestedState(): GraphStateId {
    if (this.#requestedState === null) {
      throw new Error("requested state is unavailable");
    }
    return this.#requestedState;
  }

  #assertInstalled(operation: string): void {
    if (this.#graph === null) {
      throw new MotionGraphError("NOT_READY", `${operation} requires graph metadata`);
    }
  }

  #assertPhase(expected: MotionGraphSnapshot["phase"], operation: string): void {
    this.#assertInstalled(operation);
    if (this.#phase !== expected) {
      throw new MotionGraphError(
        "NOT_READY",
        `${operation} requires phase ${expected}, not ${this.#phase}`
      );
    }
  }
}

function freezePresentation<T extends GraphPresentation>(
  presentation: T
): Readonly<T> {
  return Object.freeze(presentation);
}

function freezeEffect<T extends MotionGraphEffect>(effect: T): Readonly<T> {
  return Object.freeze(effect);
}

function isValidatedGraph(
  value: MotionGraphDefinition | ValidatedMotionGraph
): value is ValidatedMotionGraph {
  return (
    value !== null &&
    typeof value === "object" &&
    "definition" in value &&
    !Array.isArray(value)
  );
}
