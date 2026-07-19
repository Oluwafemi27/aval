import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  Player,
  PlayerDecoderDiagnostic,
  PlayerInput,
  PlayerRendererDiagnostic,
  PlayerSnapshot
} from "../src/player-contract.js";
import type { AvalElement, Binding } from "../src/public-types.js";
import { AvalPlaybackError } from "../src/errors.js";

const harness = vi.hoisted(() => ({
  brokerMode: "immediate" as "immediate" | "queued",
  inputs: [] as unknown[],
  players: [] as unknown[],
  failNextPrepare: false,
  failNextPrepareGeneric: false,
  deferNextPrepareFailure: false,
  deferNextDispose: false,
  deferredFailures: [] as DeferredFailure[],
  deferredDisposals: [] as Array<() => void>,
  participants: new Set<BrokerParticipant>(),
  tickets: [] as BrokerTicket[],
  bindings: [] as Binding[],
  operations: [] as string[]
}));

vi.mock("../src/page-resources.js", () => ({
  createPageDecoderParticipant: (visible = true) => {
    const participant: BrokerParticipant = {
      visible,
      disposed: false,
      bytes: 0,
      ticket: null
    };
    harness.participants.add(participant);
    return Object.freeze({
      request: () => {
        const ticket = createBrokerTicket(
          participant,
          harness.brokerMode === "immediate"
        );
        participant.ticket = ticket;
        harness.tickets.push(ticket);
        return Object.freeze({
          take: () => ticket.state === "granted" ? ticket.lease : null,
          wait: () => ticket.promise,
          cancel: () => cancelBrokerTicket(ticket),
          state: () => ticket.state
        });
      },
      setVisible: (next: boolean) => { participant.visible = next; },
      setPhysicalBytes: (bytes: number) => { participant.bytes = bytes; },
      dispose: () => {
        if (participant.disposed) return;
        participant.disposed = true;
        participant.bytes = 0;
        if (participant.ticket !== null) cancelBrokerTicket(participant.ticket);
        harness.participants.delete(participant);
      }
    });
  },
  pageResourcesSnapshot: () => Object.freeze({
    active: harness.tickets.reduce(
      (sum, { state }) => sum + (state === "granted" ? 2 : 0),
      0
    ),
    queued: harness.tickets.filter(({ state }) => state === "queued").length,
    parked: 0,
    participants: harness.participants.size,
    physicalBytes: [...harness.participants].reduce((sum, value) => sum + value.bytes, 0)
  })
}));

vi.mock("../src/player.js", () => ({
  createPlayer: async (input: PlayerInput): Promise<Player> => {
    const granted = input.decoderReady();
    const failPrepare = harness.failNextPrepare;
    harness.failNextPrepare = false;
    const failPrepareGeneric = harness.failNextPrepareGeneric;
    harness.failNextPrepareGeneric = false;
    const deferPrepareFailure = harness.deferNextPrepareFailure;
    harness.deferNextPrepareFailure = false;
    let state = input.initialState ?? "idle";
    let disposed = false;
    let animationRetired = false;
    let disposal: Promise<void> | null = null;
    let decoderDiagnostics: readonly Readonly<PlayerDecoderDiagnostic>[] = Object.freeze([]);
    let rendererDiagnostics: readonly Readonly<PlayerRendererDiagnostic>[] = Object.freeze([]);
    const metadata = Object.freeze({
      initialState: "idle",
      stateNames: Object.freeze(["idle", "hover"]),
      eventNames: Object.freeze([]),
      bindings: Object.freeze(harness.bindings.map((binding) =>
        Object.freeze({ ...binding })
      )),
      canvas: Object.freeze({
        width: 16,
        height: 16,
        pixelAspect: Object.freeze([1, 1] as const),
        fit: "contain" as const
      })
    });
    const snapshot = (): Readonly<PlayerSnapshot> => Object.freeze({
      requestedState: state,
      visualState: state,
      transitioning: false,
      selectedRendition: granted ? "main" : null,
      selectedCodec: granted ? "avc1.64001E" : null,
      selectedBitDepth: granted ? 8 : null,
      transportMode: granted ? "range" : null,
      declaredFileBytes: disposed || animationRetired ? 0 : 1_024,
      metadataBytes: disposed || animationRetired ? 0 : 128,
      verifiedBytes: 0,
      residentBlobBytes: 0,
      activeTransportBodies: 0,
      pendingLoads: 0,
      interestedWaiters: 0,
      workerCount: 0,
      openFrames: 0,
      contextLossCount: 0,
      contextRecoveryCount: 0,
      decoderDiagnostics,
      rendererDiagnostics,
      presentation: Object.freeze({
        cssWidth: disposed || animationRetired ? 0 : 16,
        cssHeight: disposed || animationRetired ? 0 : 16,
        backingWidth: disposed || animationRetired ? 0 : 16,
        backingHeight: disposed || animationRetired ? 0 : 16,
        effectiveDprX: disposed || animationRetired ? 0 : 1,
        effectiveDprY: disposed || animationRetired ? 0 : 1,
        stagingBytes: 0,
        residentBytes: 0,
        textureBytes: 0,
        runtimeBytes: 0,
        pendingOperations: 0,
        sourceCopiesInFlight: 0,
        resourceCount: 0,
        contextListenerCount: 0
      }),
      trace: Object.freeze([])
    });
    const publish = () => {
      harness.operations.push("publish");
      input.onMetadata(metadata);
      input.onReadiness("metadataReady");
      input.onEvent("requestedstatechange", Object.freeze({
        from: state,
        to: state,
        sequence: 0,
        isTransitioning: false
      }));
      input.onEvent("visualstatechange", Object.freeze({
        from: state,
        to: state,
        isTransitioning: false
      }));
      if (failPrepare) return;
      if (granted) {
        input.onReadiness("visualReady");
        input.onReadiness("interactiveReady");
        input.onDraw();
      } else {
        input.onReadiness("staticReady", "decoder-queued");
        input.onAnimationResourcesRetired();
      }
    };
    const player: TestPlayer = {
      metadata,
      activate: (options = {}) => {
        if (options.publish !== false) publish();
      },
      publish,
      prepare: () => {
        harness.operations.push("prepare");
        if (deferPrepareFailure) {
          return new Promise((_, reject) => {
            harness.deferredFailures.push({
              fail: () => {
                animationRetired = true;
                input.onAnimationResourcesRetired();
                reject(input.onPlaybackFailure(
                  "worker-decode-failure",
                  "prepare"
                ));
              }
            });
          });
        }
        if (failPrepare) {
          animationRetired = true;
          input.onAnimationResourcesRetired();
          return Promise.reject(input.onPlaybackFailure(
            "worker-decode-failure",
            "prepare"
          ));
        }
        if (failPrepareGeneric) {
          return Promise.reject(new Error("synthetic preparation failure"));
        }
        return Promise.resolve(granted ? animatedResult() : queuedResult());
      },
      setState: async (next) => {
        const previous = state;
        state = next;
        input.onEvent("requestedstatechange", Object.freeze({
          from: previous,
          to: next,
          sequence: 1,
          isTransitioning: false
        }));
        input.onEvent("visualstatechange", Object.freeze({
          from: previous,
          to: next,
          isTransitioning: false
        }));
      },
      canSend: () => false,
      send: (event) => {
        harness.operations.push(`send:${event}`);
        return true;
      },
      readyFor: () => true,
      pause: () => undefined,
      resume: async () => undefined,
      setMotion: async () => undefined,
      suspend: async () => {
        animationRetired = true;
        input.onReadiness("staticReady", "visibility-suspended");
        input.onAnimationResourcesRetired();
        return suspendedResult();
      },
      setVisibility: () => undefined,
      resize: () => undefined,
      snapshot,
      settled: async () => undefined,
      dispose: () => {
        if (!harness.deferNextDispose) {
          disposed = true;
          return Promise.resolve();
        }
        disposal ??= new Promise<void>((resolve) => {
          harness.deferredDisposals.push(() => {
            disposed = true;
            harness.deferNextDispose = false;
            resolve();
          });
        });
        return disposal;
      },
      failActive: () => {
        const firstFrame = Object.freeze({
          timestamp: 0,
          duration: 33_333,
          codedWidth: 16,
          codedHeight: 16,
          displayWidth: 16,
          displayHeight: 16,
          visibleRect: Object.freeze({ x: 0, y: 0, width: 16, height: 16 }),
          colorSpace: Object.freeze([
            "bt709",
            "bt709",
            "bt709",
            false
          ] as const)
        });
        const lastGoodFrame = Object.freeze({
          ...firstFrame,
          timestamp: 33_333,
          visibleRect: Object.freeze({ ...firstFrame.visibleRect }),
          colorSpace: Object.freeze([...firstFrame.colorSpace] as const)
        });
        const outputFailure = Object.freeze({
          kind: "display-aspect" as const,
          validationLayer: "host-expectation" as const,
          field: "display-aspect" as const,
          expected: Object.freeze({
            timestamp: 66_666,
            duration: 33_333,
            codedWidth: 16,
            codedHeight: 16,
            displayAspectWidth: 16,
            displayAspectHeight: 16,
            visibleRect: Object.freeze({ x: 0, y: 0, width: 16, height: 16 }),
            colorSpace: Object.freeze([
              "bt709",
              "bt709",
              "bt709",
              false
            ] as const),
            frameCount: null
          }),
          actual: Object.freeze({
            timestamp: 66_666,
            duration: 33_333,
            codedWidth: 16,
            codedHeight: 16,
            displayWidth: 32,
            displayHeight: 16,
            visibleRect: Object.freeze({ x: 0, y: 0, width: 16, height: 16 }),
            colorSpace: Object.freeze([
              "bt709",
              "bt709",
              "bt709",
              false
            ] as const),
            receivedFrameCount: null
          })
        });
        const diagnostic: Readonly<PlayerDecoderDiagnostic> = Object.freeze({
          sourceIndex: 0,
          rendition: "main",
          codec: "avc1.64001E",
          unit: "idle-body",
          lane: 0,
          logicalRunId: 1,
          role: "foreground",
          graph: Object.freeze({
            requestedState: "idle",
            visualState: "idle",
            activeUnit: "idle-body",
            pendingUnit: null
          }),
          phase: "output-validation",
          code: "invalid-output",
          run: 1,
          decodeOrdinal: 2,
          exception: Object.freeze({
            name: "DataError",
            message: "decoded frame display aspect does not match AVAL rendition"
          }),
          firstFrame,
          lastGoodFrame,
          outputFailure
        });
        decoderDiagnostics = Object.freeze([diagnostic]);
        input.onDecoderDiagnostics?.(decoderDiagnostics);
        animationRetired = true;
        input.onAnimationResourcesRetired();
        return input.onPlaybackFailure("worker-decode-failure", "playback");
      },
      failRendererActive: () => {
        const diagnostic: Readonly<PlayerRendererDiagnostic> = Object.freeze({
          sourceIndex: 0,
          rendition: "main",
          codec: "avc1.64001E",
          phase: "rgba-copy",
          operation: "runtime",
          operationOrdinal: 7,
          exception: Object.freeze({
            name: "EncodingError",
            message: "synthetic renderer copy failed"
          }),
          glError: null,
          contextLost: false,
          uploadPath: "rgba-copy",
          textureOrdinal: null,
          layout: Object.freeze({
            codedWidth: 16,
            codedHeight: 16,
            storageWidth: 16,
            storageHeight: 16,
            logicalWidth: 16,
            logicalHeight: 16
          }),
          backing: Object.freeze({ width: 16, height: 16 }),
          bytes: Object.freeze({
            stagingBytes: 1_024,
            residentBytes: 0,
            textureBytes: 3_840,
            backingBytes: 1_280,
            runtimeBytes: 6_144,
            maxTextureBytes: 16_000_000,
            maxBackingBytes: 16_000_000,
            maxRuntimeBytes: 16_000_000
          }),
          limits: Object.freeze({
            maxTextureSize: 8_192,
            maxViewportWidth: 8_192,
            maxViewportHeight: 8_192,
            maxResidentTextures: 4_096
          }),
          contextAttributes: Object.freeze({
            alpha: true,
            antialias: false,
            depth: false,
            desynchronized: true,
            failIfMajorPerformanceCaveat: false,
            powerPreference: "default",
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            stencil: false,
            xrCompatible: false
          }),
          vendor: "Synthetic Vendor",
          renderer: "Synthetic Renderer"
        });
        rendererDiagnostics = Object.freeze([diagnostic]);
        input.onRendererDiagnostics?.(rendererDiagnostics);
        animationRetired = true;
        input.onAnimationResourcesRetired();
        return input.onPlaybackFailure("renderer-failure", "render");
      },
      disposed: () => disposed
    };
    harness.inputs.push(input);
    harness.players.push(player);
    await input.onCandidate?.(player);
    return player;
  }
}));

import { createAvalElementClass } from "../src/aval-element.js";

const elements: AvalElement[] = [];

afterEach(async () => {
  await Promise.allSettled(elements.splice(0).map((element) => element.dispose()));
  for (const participant of [...harness.participants]) {
    participant.disposed = true;
    if (participant.ticket !== null) cancelBrokerTicket(participant.ticket);
    harness.participants.delete(participant);
  }
  harness.inputs.length = 0;
  harness.players.length = 0;
  harness.failNextPrepare = false;
  harness.failNextPrepareGeneric = false;
  harness.deferNextPrepareFailure = false;
  harness.deferNextDispose = false;
  harness.deferredFailures.length = 0;
  harness.deferredDisposals.length = 0;
  harness.tickets.length = 0;
  harness.bindings.length = 0;
  harness.operations.length = 0;
  FakeMutationObserver.instances.length = 0;
  await settleMicrotasks();
});

describe("element lifecycle regressions", () => {
  it("reconciles initial input and visibility bindings before qualification", async () => {
    harness.brokerMode = "immediate";
    harness.bindings.push(
      { source: "pointer.leave", event: "pointer-idle" },
      { source: "focus.out", event: "focus-idle" },
      { source: "engagement.off", event: "disengaged" },
      { source: "visible", event: "became-visible" }
    );
    const { element } = createConnectedElement("motion.avl");

    await element.prepare();

    const prepare = harness.operations.indexOf("prepare");
    const publish = harness.operations.indexOf("publish");
    for (const event of [
      "pointer-idle",
      "focus-idle",
      "disengaged",
      "became-visible"
    ]) {
      const sent = harness.operations.indexOf(`send:${event}`);
      expect.soft(sent, event).toBeGreaterThanOrEqual(0);
      expect.soft(sent, event).toBeLessThan(prepare);
    }
    expect.soft(prepare).toBeLessThan(publish);
  });

  it("retains one canonical playback error until a newer source generation", async () => {
    harness.brokerMode = "immediate";
    harness.failNextPrepare = true;
    const { element, source } = createConnectedElement("broken.avl");
    const errors: Array<CustomEvent<Readonly<{
      generation: number;
      failure: Readonly<{ code: string; message: string; operation: string | null }>;
      fatal: boolean;
    }>>> = [];
    element.addEventListener("error", ((event: CustomEvent) => {
      errors.push(event as typeof errors[number]);
    }) as EventListener);

    let first!: AvalPlaybackError;
    try {
      await element.prepare();
    } catch (error) {
      expect(error).toBeInstanceOf(AvalPlaybackError);
      first = error as AvalPlaybackError;
    }

    expect(errors).toHaveLength(1);
    expect(errors[0]!.detail.fatal).toBe(true);
    expect(errors[0]!.detail.failure).toBe(first.failure);
    expect(element.readiness).toBe("error");
    expect(element.getDiagnostics().lastFailure).toBe(first.failure);
    const playerCount = harness.players.length;

    await expect(element.prepare()).rejects.toBe(first);
    expect(errors).toHaveLength(1);
    expect(harness.players).toHaveLength(playerCount);

    source.setAttribute("src", "healthy.avl");
    FakeMutationObserver.instances[0]!.enqueue(attributeMutation(source));
    await expect(element.prepare()).resolves.toMatchObject({ mode: "animated" });
    expect(harness.players).toHaveLength(playerCount + 1);
    expect(element.getDiagnostics().lastFailure).toBeNull();
  });

  it.each(["setState", "resume"] as const)(
    "rejects a %s continuation with the retained terminal error",
    async (operation) => {
      harness.brokerMode = "immediate";
      const { element } = createConnectedElement("motion.avl");
      await element.prepare();
      if (operation === "resume") element.pause();
      const events: CustomEvent[] = [];
      element.addEventListener("error", ((event: CustomEvent) => {
        events.push(event);
      }) as EventListener);

      const pending = operation === "setState"
        ? element.setState("hover")
        : element.resume();
      void pending.catch(() => undefined);
      const terminal = playerAt(0).failActive();

      await expect(pending).rejects.toBe(terminal);
      expect(events).toHaveLength(1);
      expect(events[0]!.detail).toMatchObject({ fatal: true, generation: 1 });
      expect(events[0]!.detail.failure).toBe(terminal.failure);
      await expect(element.prepare()).rejects.toBe(terminal);
      await eventually(() => playerAt(0).disposed());
      expect(element.getDiagnostics()).toMatchObject({
        readiness: "error",
        lastFailure: terminal.failure,
        outstanding: { player: 0, decoder: 0, bytes: 0 }
      });
    }
  );

  it("retires an active failed generation before publishing one retained error", async () => {
    harness.brokerMode = "immediate";
    const { element, source } = createConnectedElement("motion.avl");
    const fallbackSource = new FakeElement("source", source.ownerDocument);
    fallbackSource.parentElement = element as unknown as FakeHTMLElement;
    fallbackSource.setAttribute("src", "motion-vp9.avl");
    fallbackSource.setAttribute(
      "type",
      'application/vnd.aval; codecs="vp09.00.21.08.01.01.01.01.00"'
    );
    (element as AvalElement & FakeHTMLElement).childElements.push(fallbackSource);
    await element.prepare();
    const player = playerAt(0);
    const rejectedProbe: Readonly<PlayerDecoderDiagnostic> = Object.freeze({
      sourceIndex: 0,
      rendition: "av1",
      codec: "av01.0.08M.10",
      unit: null,
      lane: 1,
      logicalRunId: null,
      role: null,
      graph: Object.freeze({
        requestedState: null,
        visualState: null,
        activeUnit: null,
        pendingUnit: null
      }),
      phase: "probe",
      code: "unsupported-config",
      run: null,
      decodeOrdinal: null,
      exception: Object.freeze({
        name: "NotSupportedError",
        message: "decoder configuration is unsupported"
      }),
      firstFrame: null,
      lastGoodFrame: null,
      outputFailure: null
    });
    const laterRejectedProbe: Readonly<PlayerDecoderDiagnostic> = Object.freeze({
      ...rejectedProbe,
      sourceIndex: 1,
      rendition: "vp9",
      codec: "vp09.00.21.08.01.01.01.01.00"
    });
    inputAt(0).onDecoderDiagnostics?.(Object.freeze([rejectedProbe]));
    inputAt(0).onDecoderDiagnostics?.(Object.freeze([laterRejectedProbe]));
    inputAt(0).onDecoderDiagnostics?.(Object.freeze([]));
    expect(element.getDiagnostics().runtime.decoderDiagnostics).toMatchObject([
      {
        sourceGeneration: 1,
        lane: 1,
        rendition: "av1",
        code: "unsupported-config"
      },
      {
        sourceGeneration: 1,
        sourceIndex: 1,
        lane: 1,
        rendition: "vp9",
        code: "unsupported-config"
      }
    ]);
    const events: CustomEvent[] = [];
    let diagnosticsAtEvent: ReturnType<AvalElement["getDiagnostics"]> | null = null;
    element.addEventListener("error", ((event: CustomEvent) => {
      events.push(event);
      diagnosticsAtEvent = element.getDiagnostics();
    }) as EventListener);

    const error = player.failActive();

    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toMatchObject({ fatal: true, generation: 1 });
    expect(events[0]!.detail.failure).toBe(error.failure);
    expect(diagnosticsAtEvent).toMatchObject({
      readiness: "error",
      mode: null,
      lastFailure: error.failure,
      outstanding: { decoder: 0, bytes: 0 },
      runtime: {
        declaredFileBytes: 0,
        activeLeaseCount: 0,
        pageParticipantCount: 0,
        pagePhysicalBytes: 0,
        decoderDiagnostics: [
          {
            sourceGeneration: 1,
            sourceIndex: 0,
            rendition: "main",
            codec: "avc1.64001E",
            unit: "idle-body",
            lane: 0,
            logicalRunId: 1,
            role: "foreground",
            graph: {
              requestedState: "idle",
              visualState: "idle",
              activeUnit: "idle-body",
              pendingUnit: null
            },
            phase: "output-validation",
            code: "invalid-output",
            run: 1,
            decodeOrdinal: 2,
            exception: {
              name: "DataError",
              message: "decoded frame display aspect does not match AVAL rendition"
            },
            firstFrame: { timestamp: 0 },
            lastGoodFrame: { timestamp: 33_333 },
            outputFailure: {
              kind: "display-aspect",
              validationLayer: "host-expectation",
              field: "display-aspect"
            }
          },
          {
            sourceGeneration: 1,
            sourceIndex: 0,
            rendition: "av1",
            codec: "av01.0.08M.10",
            unit: null,
            lane: 1,
            phase: "probe",
            code: "unsupported-config",
            run: null,
            decodeOrdinal: null,
            exception: {
              name: "NotSupportedError",
              message: "decoder configuration is unsupported"
            },
            firstFrame: null
          },
          {
            sourceGeneration: 1,
            sourceIndex: 1,
            rendition: "vp9",
            codec: "vp09.00.21.08.01.01.01.01.00",
            unit: null,
            lane: 1,
            phase: "probe",
            code: "unsupported-config",
            run: null,
            decodeOrdinal: null,
            exception: {
              name: "NotSupportedError",
              message: "decoder configuration is unsupported"
            },
            firstFrame: null
          }
        ]
      }
    });
    const capturedAtEvent = diagnosticsAtEvent as unknown as ReturnType<
      AvalElement["getDiagnostics"]
    >;
    const decoderDiagnosticsAtEvent = capturedAtEvent.runtime.decoderDiagnostics;
    const [diagnosticAtEvent, probeAtEvent, laterProbeAtEvent] =
      decoderDiagnosticsAtEvent;
    expect(diagnosticAtEvent).toEqual({
      sourceGeneration: 1,
      sourceIndex: 0,
      rendition: "main",
      codec: "avc1.64001E",
      unit: "idle-body",
      lane: 0,
      logicalRunId: 1,
      role: "foreground",
      graph: {
        requestedState: "idle",
        visualState: "idle",
        activeUnit: "idle-body",
        pendingUnit: null
      },
      phase: "output-validation",
      code: "invalid-output",
      run: 1,
      decodeOrdinal: 2,
      exception: {
        name: "DataError",
        message: "decoded frame display aspect does not match AVAL rendition"
      },
      firstFrame: {
        timestamp: 0,
        duration: 33_333,
        codedWidth: 16,
        codedHeight: 16,
        displayWidth: 16,
        displayHeight: 16,
        visibleRect: { x: 0, y: 0, width: 16, height: 16 },
        colorSpace: ["bt709", "bt709", "bt709", false]
      },
      lastGoodFrame: {
        timestamp: 33_333,
        duration: 33_333,
        codedWidth: 16,
        codedHeight: 16,
        displayWidth: 16,
        displayHeight: 16,
        visibleRect: { x: 0, y: 0, width: 16, height: 16 },
        colorSpace: ["bt709", "bt709", "bt709", false]
      },
      outputFailure: {
        kind: "display-aspect",
        validationLayer: "host-expectation",
        field: "display-aspect",
        expected: {
          timestamp: 66_666,
          duration: 33_333,
          codedWidth: 16,
          codedHeight: 16,
          displayAspectWidth: 16,
          displayAspectHeight: 16,
          visibleRect: { x: 0, y: 0, width: 16, height: 16 },
          colorSpace: ["bt709", "bt709", "bt709", false],
          frameCount: null
        },
        actual: {
          timestamp: 66_666,
          duration: 33_333,
          codedWidth: 16,
          codedHeight: 16,
          displayWidth: 32,
          displayHeight: 16,
          visibleRect: { x: 0, y: 0, width: 16, height: 16 },
          colorSpace: ["bt709", "bt709", "bt709", false],
          receivedFrameCount: null
        }
      }
    });
    expect(Object.isFrozen(decoderDiagnosticsAtEvent)).toBe(true);
    expectDeeplyFrozen(diagnosticAtEvent);
    expect(Object.isFrozen(probeAtEvent)).toBe(true);
    expect(Object.isFrozen(laterProbeAtEvent)).toBe(true);
    await expect(element.prepare()).rejects.toBe(error);
    expect(events).toHaveLength(1);

    await eventually(() => player.disposed());
    expect(element.getDiagnostics().outstanding.player).toBe(0);
    const diagnosticsAfterCleanup =
      element.getDiagnostics().runtime.decoderDiagnostics;
    expect(diagnosticsAfterCleanup).toEqual([
      diagnosticAtEvent,
      probeAtEvent,
      laterProbeAtEvent
    ]);
    expect(diagnosticsAfterCleanup[0]).toBe(diagnosticAtEvent);
    expect(diagnosticsAfterCleanup[1]).toBe(probeAtEvent);
    expect(diagnosticsAfterCleanup[2]).toBe(laterProbeAtEvent);

    source.setAttribute("src", "replacement.avl");
    FakeMutationObserver.instances[0]!.enqueue(attributeMutation(source));
    await expect(element.prepare()).resolves.toMatchObject({ mode: "animated" });
    const replacementDiagnostics = element.getDiagnostics();
    expect(replacementDiagnostics.sourceGeneration).toBe(2);
    expect(replacementDiagnostics.lastFailure).toBeNull();
    expect(replacementDiagnostics.runtime.decoderDiagnostics).toEqual([]);
    expect(replacementDiagnostics.runtime.decoderDiagnostics).not.toBe(
      diagnosticsAfterCleanup
    );
  });

  it("retains one deeply frozen renderer cause until a newer source generation", async () => {
    harness.brokerMode = "immediate";
    const { element, source } = createConnectedElement("motion.avl");
    await element.prepare();
    const player = playerAt(0);
    let diagnosticsAtEvent: ReturnType<AvalElement["getDiagnostics"]> | null = null;
    element.addEventListener("error", () => {
      diagnosticsAtEvent = element.getDiagnostics();
    }, { once: true });

    const error = player.failRendererActive();

    expect(diagnosticsAtEvent).not.toBeNull();
    const captured = diagnosticsAtEvent as unknown as ReturnType<
      AvalElement["getDiagnostics"]
    >;
    const [playerDiagnostic] = player.snapshot(false).rendererDiagnostics;
    const [publicDiagnostic] = captured.runtime.rendererDiagnostics;
    expect(publicDiagnostic).toEqual({
      ...playerDiagnostic,
      sourceGeneration: 1
    });
    expect(publicDiagnostic).toMatchObject({
      sourceGeneration: 1,
      sourceIndex: 0,
      rendition: "main",
      codec: "avc1.64001E",
      phase: "rgba-copy",
      operation: "runtime",
      operationOrdinal: 7,
      exception: {
        name: "EncodingError",
        message: "synthetic renderer copy failed"
      },
      glError: null,
      contextLost: false,
      uploadPath: "rgba-copy"
    });
    expect(Object.isFrozen(captured.runtime.rendererDiagnostics)).toBe(true);
    expectDeeplyFrozen(publicDiagnostic);
    await expect(element.prepare()).rejects.toBe(error);

    await eventually(() => player.disposed());
    const diagnosticsAfterCleanup =
      element.getDiagnostics().runtime.rendererDiagnostics;
    expect(diagnosticsAfterCleanup).toHaveLength(1);
    expect(diagnosticsAfterCleanup[0]).toBe(publicDiagnostic);

    source.setAttribute("src", "replacement.avl");
    FakeMutationObserver.instances[0]!.enqueue(attributeMutation(source));
    await expect(element.prepare()).resolves.toMatchObject({ mode: "animated" });
    const replacement = element.getDiagnostics();
    expect(replacement.sourceGeneration).toBe(2);
    expect(replacement.lastFailure).toBeNull();
    expect(replacement.runtime.rendererDiagnostics).toEqual([]);
    expect(replacement.runtime.rendererDiagnostics).not.toBe(
      diagnosticsAfterCleanup
    );
  });

  it("does not let deferred terminal retirement cancel an error-listener replacement", async () => {
    harness.brokerMode = "immediate";
    const { element, source } = createConnectedElement("motion.avl");
    await element.prepare();
    let replacement: Promise<unknown> | null = null;
    element.addEventListener("error", () => {
      source.setAttribute("src", "replacement.avl");
      FakeMutationObserver.instances[0]!.enqueue(attributeMutation(source));
      replacement = element.prepare();
    }, { once: true });

    playerAt(0).failActive();

    await eventually(() => replacement !== null);
    await expect(replacement).resolves.toMatchObject({ mode: "animated" });
    expect(harness.players).toHaveLength(2);
    expect(element.getDiagnostics()).toMatchObject({
      sourceGeneration: 2,
      readiness: "interactiveReady",
      lastFailure: null
    });
  });

  it("does not publish an old failure when cleanup is superseded", async () => {
    harness.brokerMode = "immediate";
    harness.failNextPrepareGeneric = true;
    harness.deferNextDispose = true;
    const { element, source } = createConnectedElement("old.avl");
    const errors: CustomEvent[] = [];
    element.addEventListener("error", ((event: CustomEvent) => {
      errors.push(event);
    }) as EventListener);
    const stale = element.prepare();
    void stale.catch(() => undefined);
    await eventually(() => harness.deferredDisposals.length === 1);

    source.setAttribute("src", "new.avl");
    FakeMutationObserver.instances[0]!.enqueue(attributeMutation(source));
    const replacement = element.prepare();
    harness.deferredDisposals[0]!();

    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    await expect(replacement).resolves.toMatchObject({ mode: "animated" });
    expect(errors).toHaveLength(0);
    expect(element.getDiagnostics().lastFailure).toBeNull();
  });

  it("turns a superseded deferred terminal failure into AbortError", async () => {
    harness.brokerMode = "immediate";
    harness.deferNextPrepareFailure = true;
    const { element, source } = createConnectedElement("old.avl");
    const events: CustomEvent[] = [];
    element.addEventListener("error", ((event: CustomEvent) => {
      events.push(event);
    }) as EventListener);
    const stale = element.prepare();
    void stale.catch(() => undefined);
    await eventually(() => harness.deferredFailures.length === 1);

    source.setAttribute("src", "new.avl");
    FakeMutationObserver.instances[0]!.enqueue(attributeMutation(source));
    const replacement = element.prepare();
    harness.deferredFailures[0]!.fail();

    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    await expect(replacement).resolves.toMatchObject({ mode: "animated" });
    expect(events).toHaveLength(0);
    expect(element.getDiagnostics().lastFailure).toBeNull();
  });

  it("releases a stale queued decoder grant without restarting the replaced source", async () => {
    harness.brokerMode = "queued";
    const { element, source } = createConnectedElement("first.avl");
    await element.prepare();
    const stale = harness.tickets[0]!;
    expect(stale.state).toBe("queued");
    expect(stale).not.toHaveProperty("weight");

    source.setAttribute("src", "second.avl");
    FakeMutationObserver.instances[0]!.enqueue(attributeMutation(source));
    grantBrokerTicket(stale);
    const replacement = element.prepare();

    await Promise.resolve();
    expect.soft(stale.releases, "the stale lease must be released in its grant callback").toBe(1);
    await replacement;
    expect(harness.inputs).toHaveLength(2);
    expect(inputAt(1).sources[0]?.src).toBe("second.avl");
    expect(inputAt(1).initialState).toBeNull();
  });

  it("preserves requested state across persisted BFCache restore after suspension completes", async () => {
    harness.brokerMode = "immediate";
    const { element, view } = createConnectedElement("motion.avl");
    await element.prepare();
    await element.setState("hover");
    expect(element.requestedState).toBe("hover");

    view.dispatchEvent(new Event("pagehide"));
    await settleMicrotasks();
    expect(element.staticReason).toBe("visibility-suspended");

    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    view.dispatchEvent(restored);
    await element.prepare();

    expect(harness.inputs).toHaveLength(2);
    expect(inputAt(1).initialState).toBe("hover");
  });
});

type BrokerState = "queued" | "granted" | "cancelled" | "released";
type BrokerLease = Readonly<{ release: () => void }>;
interface BrokerParticipant {
  visible: boolean;
  disposed: boolean;
  bytes: number;
  ticket: BrokerTicket | null;
}
interface BrokerTicket {
  readonly participant: BrokerParticipant;
  state: BrokerState;
  lease: BrokerLease | null;
  readonly promise: Promise<BrokerLease>;
  resolve: ((lease: BrokerLease) => void) | null;
  reject: ((reason: unknown) => void) | null;
  releases: number;
}

interface DeferredFailure {
  fail(): void;
}

interface TestPlayer extends Player {
  failActive(): AvalPlaybackError;
  failRendererActive(): AvalPlaybackError;
  disposed(): boolean;
}

function createBrokerTicket(
  participant: BrokerParticipant,
  immediate: boolean
): BrokerTicket {
  let resolve!: (lease: BrokerLease) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<BrokerLease>((accepted, rejected) => {
    resolve = accepted;
    reject = rejected;
  });
  const ticket: BrokerTicket = {
    participant,
    state: "queued",
    lease: null,
    promise,
    resolve,
    reject,
    releases: 0
  };
  if (immediate) grantBrokerTicket(ticket);
  return ticket;
}

function grantBrokerTicket(ticket: BrokerTicket): void {
  if (ticket.state !== "queued") throw new Error("ticket is not queued");
  ticket.state = "granted";
  let released = false;
  const lease = Object.freeze({
    release: () => {
      if (released) return;
      released = true;
      ticket.releases += 1;
      ticket.state = "released";
      ticket.lease = null;
      if (ticket.participant.ticket === ticket) ticket.participant.ticket = null;
    }
  });
  ticket.lease = lease;
  ticket.resolve?.(lease);
  ticket.resolve = null;
  ticket.reject = null;
}

function cancelBrokerTicket(ticket: BrokerTicket): void {
  if (ticket.state === "granted") {
    ticket.lease?.release();
    return;
  }
  if (ticket.state !== "queued") return;
  ticket.state = "cancelled";
  ticket.reject?.(new DOMException("Decoder request cancelled", "AbortError"));
  ticket.resolve = null;
  ticket.reject = null;
  if (ticket.participant.ticket === ticket) ticket.participant.ticket = null;
}

function inputAt(index: number): Readonly<PlayerInput> {
  return harness.inputs[index] as Readonly<PlayerInput>;
}

function playerAt(index: number): TestPlayer {
  return harness.players[index] as TestPlayer;
}

function animatedResult() {
  return Object.freeze({
    mode: "animated" as const,
    assurance: "best-effort" as const,
    report: Object.freeze({
      readiness: "interactiveReady" as const,
      selectedRendition: "main",
      candidates: Object.freeze([])
    })
  });
}

function queuedResult() {
  return Object.freeze({
    mode: "static" as const,
    reason: "decoder-queued" as const,
    report: Object.freeze({
      readiness: "staticReady" as const,
      selectedRendition: null,
      candidates: Object.freeze([])
    })
  });
}

function suspendedResult() {
  return Object.freeze({
    mode: "static" as const,
    reason: "visibility-suspended" as const,
    report: Object.freeze({
      readiness: "staticReady" as const,
      selectedRendition: null,
      candidates: Object.freeze([])
    })
  });
}

const HTML = "http://www.w3.org/1999/xhtml";
let currentDocument: FakeDocument;

function createConnectedElement(src: string): {
  element: AvalElement;
  source: FakeElement;
  view: FakeWindow;
} {
  const view = new FakeWindow();
  currentDocument = new FakeDocument(view);
  view.document = currentDocument;
  const Constructor = createAvalElementClass(
    FakeHTMLElement as unknown as typeof HTMLElement
  );
  const element = new Constructor() as AvalElement & FakeHTMLElement & {
    connectedCallback(): void;
  };
  const source = new FakeElement("source", currentDocument);
  source.parentElement = element as unknown as FakeHTMLElement;
  source.setAttribute("src", src);
  source.setAttribute("type", 'application/vnd.aval; codecs="avc1.64001E"');
  element.childElements.push(source);
  element.isConnected = true;
  element.connectedCallback();
  elements.push(element);
  return { element, source, view };
}

class FakeHTMLElement extends EventTarget {
  public readonly ownerDocument = currentDocument;
  public readonly childElements: FakeElement[] = [];
  public readonly attributes = new Map<string, string>();
  public readonly localName = "aval-player";
  public readonly namespaceURI = HTML;
  public readonly nodeType = 1;
  public isConnected = false;
  readonly #root = new FakeShadowRoot(this.ownerDocument);

  public get children(): HTMLCollection {
    return {
      length: this.childElements.length,
      item: (index: number) => this.childElements[index] ?? null
    } as unknown as HTMLCollection;
  }

  public attachShadow(): ShadowRoot { return this.#root as unknown as ShadowRoot; }
  public getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  public setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  public removeAttribute(name: string): void { this.attributes.delete(name); }
  public getBoundingClientRect(): DOMRect {
    return { width: 16, height: 16 } as DOMRect;
  }
  public matches(_selector: string): boolean { return false; }
  public contains(node: unknown): boolean { return node === this; }
  public getRootNode(): Document { return this.ownerDocument as unknown as Document; }
}

class FakeElement extends EventTarget {
  public readonly nodeType = 1;
  public readonly namespaceURI = HTML;
  public readonly dataset: Record<string, string> = {};
  public parentElement: FakeHTMLElement | null = null;
  public hidden = false;
  public name = "";
  public width = 0;
  public height = 0;
  public tabIndex = 0;
  readonly #attributes = new Map<string, string>();

  public constructor(
    public readonly localName: string,
    public readonly ownerDocument: FakeDocument
  ) { super(); }

  public getAttribute(name: string): string | null { return this.#attributes.get(name) ?? null; }
  public setAttribute(name: string, value: string): void { this.#attributes.set(name, value); }
}

class FakeShadowRoot {
  public adoptedStyleSheets: FakeCSSStyleSheet[] = [];
  public constructor(public readonly ownerDocument: FakeDocument) {}
  public append(..._nodes: unknown[]): void {}
}

class FakeCSSStyleRule {
  public readonly style = { setProperty: () => undefined };
}

class FakeCSSStyleSheet {
  public readonly cssRules = { item: () => new FakeCSSStyleRule() };
  public replaceSync(_css: string): void {}
}

class FakeCustomEvent<T> extends Event {
  public readonly detail: T;
  public constructor(type: string, init: CustomEventInit<T>) {
    super(type, init);
    this.detail = init.detail as T;
  }
}

class FakeMutationObserver {
  public static readonly instances: FakeMutationObserver[] = [];
  readonly #records: MutationRecord[] = [];
  public constructor(readonly callback: MutationCallback) {
    FakeMutationObserver.instances.push(this);
  }
  public observe(): void {}
  public disconnect(): void { this.#records.length = 0; }
  public takeRecords(): MutationRecord[] { return this.#records.splice(0); }
  public enqueue(record: MutationRecord): void { this.#records.push(record); }
}

class FakeIntersectionObserver {
  public constructor(readonly callback: IntersectionObserverCallback) {}
  public observe(target: Element): void {
    this.callback([{
      target,
      isIntersecting: true,
      intersectionRatio: 1
    } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  public disconnect(): void {}
}

class FakeWindow extends EventTarget {
  public document!: FakeDocument;
  public readonly MutationObserver = FakeMutationObserver;
  public readonly IntersectionObserver = FakeIntersectionObserver;
  public readonly CSSStyleSheet = FakeCSSStyleSheet;
  public readonly CSSStyleRule = FakeCSSStyleRule;
  public readonly CustomEvent = FakeCustomEvent;
  public readonly Element = FakeHTMLElement;
  public readonly Worker = class {};
  public readonly VideoDecoder = class {};
  public readonly VideoFrame = class {};
  public readonly isSecureContext = true;
  public readonly crypto = {
    subtle: { digest: () => Promise.resolve(new ArrayBuffer(32)) }
  } as unknown as Crypto;
  public readonly performance = globalThis.performance;
  public readonly devicePixelRatio = 1;
  public readonly fetch = async (): Promise<Response> => ({} as Response);
  public readonly requestAnimationFrame = (_callback: FrameRequestCallback): number => 1;
  public readonly cancelAnimationFrame = (_handle: number): void => undefined;
  public readonly setTimeout = (callback: () => void, delay: number): number =>
    globalThis.setTimeout(callback, delay) as unknown as number;
  public readonly clearTimeout = (handle: number): void => globalThis.clearTimeout(handle);
  public readonly matchMedia = (): MediaQueryList => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }) as unknown as MediaQueryList;
}

class FakeDocument extends EventTarget {
  public visibilityState: DocumentVisibilityState = "visible";
  public activeElement: Element | null = null;
  public readonly baseURI = "https://example.test/";
  public constructor(public readonly defaultView: FakeWindow) { super(); }
  public createElement(localName: string): FakeElement {
    return new FakeElement(localName, this);
  }
}

function attributeMutation(target: FakeElement): MutationRecord {
  return {
    type: "attributes",
    target,
    addedNodes: [],
    removedNodes: []
  } as unknown as MutationRecord;
}

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested, seen);
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 32; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition did not settle");
}
