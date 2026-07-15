import { describe, expect, it } from "vitest";

import type { ElementAssetGeneration } from "../src/asset-generation.js";
import type { AutomaticInputs } from "../src/automatic-inputs.js";
import { BindingRouter } from "../src/binding-router.js";
import { ElementCommandSlot } from "../src/element-command-slot.js";
import type { ElementConfiguration } from "../src/element-configuration.js";
import {
  elementResumeCurrent,
  elementRuntimeEffectCurrent,
  elementSourceCurrent,
  elementStateCurrent
} from "../src/element-current-predicates.js";
import type { ElementDesiredSnapshot } from "../src/element-desired-state.js";
import { ElementPublicState } from "../src/element-public-state.js";
import {
  ElementRuntimeEffects,
  resumeCommandIdentityEqual,
  stateCommandIdentityEqual,
  type ElementResumeCommandKey,
  type ElementRuntimeEffectAuthority,
  type ElementStateCommandKey
} from "../src/element-runtime-effects.js";
import type { ShadowLayerOwner } from "../src/shadow-layers.js";

describe("ElementRuntimeEffects", () => {
  it("does not apply stale visibility after source work yields to a newer revision", async () => {
    const fixture = effectsFixture();
    const stale = desired({ revision: 1, effectivelyVisible: true });
    fixture.current = desired({ revision: 2, effectivelyVisible: false });
    await fixture.effects.apply(
      stale,
      fixture.asset as unknown as ElementAssetGeneration,
      configuration(),
      fixture.authority
    );
    expect(fixture.calls.visibility).toBe(0);
  });

  it("does not serialize presentation behind motion-policy settlement", async () => {
    const fixture = effectsFixture();
    let releaseMotion: (() => void) | undefined;
    let resizeCount = 0;
    fixture.asset.setMotionPolicy = async () => {
      await new Promise<void>((resolve) => { releaseMotion = resolve; });
    };
    fixture.asset.resize = () => { resizeCount += 1; };
    const snapshot = desired({
      box: Object.freeze({ width: 640, height: 360 }),
      dpr: 2
    });
    fixture.current = snapshot;

    const applying = fixture.effects.apply(
      snapshot,
      fixture.asset as unknown as ElementAssetGeneration,
      configuration(),
      fixture.authority
    );
    for (let attempt = 0; releaseMotion === undefined && attempt < 10; attempt += 1) {
      await Promise.resolve();
    }

    expect(releaseMotion).toBeTypeOf("function");
    expect(resizeCount).toBe(1);
    releaseMotion!();
    await applying;
  });

  it("drops stale state/play phases after visibility awaits a newer pause and state", async () => {
    const fixture = effectsFixture();
    let releaseVisibility!: () => void;
    fixture.asset.setVisibility = async () => {
      await new Promise<void>((resolve) => { releaseVisibility = resolve; });
    };
    const stale = desired({
      revision: 1,
      stateIntent: Object.freeze({ name: "hover", sequence: 1 }),
      manualPlaying: true,
      playSequence: 1
    });
    fixture.current = stale;
    const applying = fixture.effects.apply(
      stale,
      fixture.asset as unknown as ElementAssetGeneration,
      configuration(),
      fixture.authority
    );
    await Promise.resolve();
    fixture.current = desired({
      revision: 2,
      stateIntent: Object.freeze({ name: "idle", sequence: 2 }),
      manualPlaying: false,
      playSequence: 2,
      effectivelyVisible: false
    });
    releaseVisibility();
    await applying;
    expect(fixture.stateCalls).toEqual([]);
    expect(fixture.calls.resume).toBe(0);

    fixture.asset.setVisibility = async () => undefined;
    await fixture.effects.apply(
      fixture.current,
      fixture.asset as unknown as ElementAssetGeneration,
      configuration(),
      fixture.authority
    );
    expect(fixture.stateCalls).toEqual(["idle"]);
    expect(fixture.calls.pause).toBe(1);
    expect(fixture.calls.resume).toBe(0);
  });

  it("keeps hidden resume pending until the current source has a usable readiness", async () => {
    const fixture = effectsFixture(false);
    const snapshot = desired({
      revision: 3,
      effectivelyVisible: false,
      manualPlaying: true,
      playSequence: 3
    });
    fixture.current = snapshot;
    const request = fixture.resumeCommand.request({ sourceToken: 1, playSequence: 3 });
    await fixture.effects.apply(
      snapshot,
      fixture.asset as unknown as ElementAssetGeneration,
      configuration(),
      fixture.authority
    );
    expect(fixture.resumeCommand.pending).toBe(1);
    expect(fixture.calls.resume).toBe(0);

    fixture.state.stageReadiness({
      value: "staticReady",
      reason: "visibility-suspended",
      motion: "auto",
      hostReduced: false,
      effectivelyVisible: false
    });
    await fixture.effects.apply(
      snapshot,
      fixture.asset as unknown as ElementAssetGeneration,
      configuration(),
      fixture.authority
    );
    await expect(request.promise).resolves.toBeUndefined();
    expect(fixture.calls.resume).toBe(0);
  });

  it("settles an exact state command across an unrelated desired revision", async () => {
    const fixture = effectsFixture();
    let releaseState: (() => void) | undefined;
    fixture.asset.setState = async (name: string) => {
      fixture.stateCalls.push(name);
      await new Promise<void>((resolve) => { releaseState = resolve; });
    };
    const intent = Object.freeze({ name: "hover", sequence: 4 });
    const snapshot = desired({ revision: 4, stateIntent: intent });
    fixture.current = snapshot;
    const command = fixture.stateCommand.request({
      sourceToken: 1,
      name: "hover",
      sequence: 4
    });
    const applying = fixture.effects.apply(
      snapshot,
      fixture.asset as unknown as ElementAssetGeneration,
      configuration(),
      fixture.authority
    );
    for (let attempt = 0; releaseState === undefined && attempt < 10; attempt += 1) {
      await Promise.resolve();
    }
    expect(releaseState).toBeTypeOf("function");
    fixture.current = desired({
      revision: 5,
      stateIntent: intent,
      box: Object.freeze({ width: 20, height: 20 }),
      dpr: 2
    });
    releaseState!();
    await applying;
    await expect(command.promise).resolves.toBeUndefined();
    expect(fixture.stateCalls).toEqual(["hover"]);
    expect(fixture.stateCommand.pending).toBe(0);
  });

  it("does not serialize pause or resume behind graph state settlement", async () => {
    const fixture = effectsFixture();
    let releaseState!: () => void;
    fixture.asset.setState = async (name: string) => {
      fixture.stateCalls.push(name);
      await new Promise<void>((resolve) => { releaseState = resolve; });
    };
    const intent = Object.freeze({ name: "hover", sequence: 5 });
    const snapshot = desired({
      revision: 5,
      stateIntent: intent,
      manualPlaying: true,
      playSequence: 5
    });
    fixture.current = snapshot;
    const command = fixture.stateCommand.request({
      sourceToken: 1,
      name: "hover",
      sequence: 5
    });
    await fixture.effects.apply(
      snapshot,
      fixture.asset as unknown as ElementAssetGeneration,
      configuration(),
      fixture.authority
    );
    expect(fixture.stateCalls).toEqual(["hover"]);
    expect(fixture.calls.resume).toBe(1);
    expect(fixture.stateCommand.pending).toBe(1);
    releaseState();
    await expect(command.promise).resolves.toBeUndefined();
  });

  it("does not report declarative state supersession as invalid configuration", async () => {
    const fixture = effectsFixture();
    fixture.asset.setState = async () => {
      const error = new Error("state request was superseded");
      error.name = "AbortError";
      throw error;
    };
    const snapshot = desired({
      revision: 6,
      stateIntent: Object.freeze({ name: "hover", sequence: 6 })
    });
    fixture.current = snapshot;

    await fixture.effects.apply(
      snapshot,
      fixture.asset as unknown as ElementAssetGeneration,
      configuration(),
      fixture.authority
    );
    await Promise.resolve();

    expect(fixture.failures).toEqual([]);
  });

  it("reports a non-abort declarative state failure as invalid configuration", async () => {
    const fixture = effectsFixture();
    fixture.asset.setState = async () => {
      throw new Error("state request failed");
    };
    const snapshot = desired({
      revision: 7,
      stateIntent: Object.freeze({ name: "hover", sequence: 7 })
    });
    fixture.current = snapshot;

    await fixture.effects.apply(
      snapshot,
      fixture.asset as unknown as ElementAssetGeneration,
      configuration(),
      fixture.authority
    );
    await Promise.resolve();

    expect(fixture.failures).toEqual(["invalid-configuration"]);
  });
});

function effectsFixture(ready = true) {
  const state = new ElementPublicState();
  state.metadataReady({
    initialState: "idle",
    stateNames: Object.freeze(["idle", "hover"]),
    eventNames: Object.freeze([]),
    bindings: Object.freeze([])
  });
  if (ready) {
    state.stageReadiness({
      value: "interactiveReady",
      reason: null,
      motion: "auto",
      hostReduced: false,
      effectivelyVisible: true
    });
  }
  const stateCommand = new ElementCommandSlot<ElementStateCommandKey>(
    (left, right) => left.sourceToken === right.sourceToken && left.name === right.name,
    null,
    stateCommandIdentityEqual
  );
  const resumeCommand = new ElementCommandSlot<ElementResumeCommandKey>(
    resumeCommandIdentityEqual
  );
  const stateCalls: string[] = [];
  const failures: unknown[] = [];
  const calls = { pause: 0, resume: 0, visibility: 0 };
  const asset = {
    generation: 1,
    setVisibility: async () => { calls.visibility += 1; },
    setMotionPolicy: async () => undefined,
    resize: () => undefined,
    setState: async (name: string) => { stateCalls.push(name); },
    pause: () => { calls.pause += 1; },
    resume: async () => { calls.resume += 1; }
  };
  const effects = new ElementRuntimeEffects({
    layers: { setIntrinsicSize: () => true } as unknown as ShadowLayerOwner,
    router: new BindingRouter(() => false),
    inputs: {
      metadataReady: () => undefined,
      metadataUnready: () => undefined,
      setRuntimeVisible: () => undefined
    } as unknown as AutomaticInputs,
    state,
    stateCommand,
    resumeCommand
  });
  const fixture: {
    current: Readonly<ElementDesiredSnapshot>;
    authority: ElementRuntimeEffectAuthority;
  } & Record<string, unknown> = {
    current: desired(),
    authority: {} as ElementRuntimeEffectAuthority
  };
  const authority: ElementRuntimeEffectAuthority = {
    runtimeEffectCurrent: (expected, candidate) => elementRuntimeEffectCurrent({
      desired: fixture.current,
      expected,
      active: candidate,
      asset: candidate
    }),
    runtimeStateCurrent: (key, candidate) => elementStateCurrent({
      desired: fixture.current,
      active: candidate,
      asset: candidate,
      key
    }),
    runtimeSourceCurrent: (sourceToken) => elementSourceCurrent(fixture.current, sourceToken),
    runtimeResumeCurrent: (key, candidate) => elementResumeCurrent({
      desired: fixture.current,
      active: candidate,
      asset: candidate,
      key
    }),
    runtimeEffectFailure: (error) => { failures.push(error); },
    runtimePresentationUnsupported: () => undefined
  };
  fixture.authority = authority;
  return Object.assign(fixture, {
    state,
    stateCommand,
    resumeCommand,
    asset,
    effects,
    stateCalls,
    failures,
    calls
  }) as typeof fixture & {
    state: ElementPublicState;
    stateCommand: ElementCommandSlot<ElementStateCommandKey>;
    resumeCommand: ElementCommandSlot<ElementResumeCommandKey>;
    asset: typeof asset;
    effects: ElementRuntimeEffects;
    stateCalls: string[];
    failures: unknown[];
    calls: { pause: number; resume: number; visibility: number };
  };
}

function desired(
  override: Partial<ElementDesiredSnapshot> = {}
): Readonly<ElementDesiredSnapshot> {
  return Object.freeze({
    revision: 0,
    sourceToken: 1,
    configuration: configuration(),
    connected: true,
    terminal: false,
    documentVisible: true,
    intersecting: true,
    positiveBox: true,
    observerSupported: true,
    effectivelyVisible: true,
    box: Object.freeze({ width: 10, height: 10 }),
    dpr: 1,
    hostReducedMotion: false,
    manualPlaying: true,
    playSequence: 0,
    stateIntent: null,
    bfcacheRestoreSequence: 0,
    realmSequence: 0,
    interactionTarget: null,
    ...override
  });
}

function configuration(): Readonly<ElementConfiguration> {
  return Object.freeze({
    src: "asset.avl",
    integrity: "",
    crossOrigin: "anonymous",
    motion: "auto",
    autoplay: "visible",
    fit: null,
    bindings: "auto",
    state: null,
    interactionFor: "",
    width: null,
    height: null
  });
}
