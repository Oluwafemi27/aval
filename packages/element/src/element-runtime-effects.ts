import type { ElementAssetGeneration } from "./asset-generation.js";
import type { AutomaticInputs } from "./automatic-inputs.js";
import type { BindingRouter } from "./binding-router.js";
import type { ElementConfiguration } from "./element-configuration.js";
import type { ElementCommandSlot } from "./element-command-slot.js";
import type { ElementDesiredSnapshot } from "./element-desired-state.js";
import type { ElementPublicState } from "./element-public-state.js";
import type { ElementSourceMetadata } from "./element-generation-publication.js";
import { applyIntrinsicSize, computeIntrinsicSize, type IntrinsicSizeResult } from "./intrinsic-size.js";
import { isExpectedAbort } from "./public-failure.js";
import type { ShadowLayerOwner } from "./shadow-layers.js";

export interface ElementStateCommandKey {
  readonly sourceToken: number;
  readonly name: string;
  readonly sequence: number;
}

export interface ElementResumeCommandKey {
  readonly sourceToken: number;
  readonly playSequence: number;
}

export interface ElementRuntimeEffectAuthority {
  runtimeEffectCurrent(
    snapshot: Readonly<ElementDesiredSnapshot>,
    asset: ElementAssetGeneration
  ): boolean;
  runtimeStateCurrent(key: ElementStateCommandKey, asset: ElementAssetGeneration): boolean;
  runtimeSourceCurrent(sourceToken: number): boolean;
  runtimeResumeCurrent(key: ElementResumeCommandKey, asset: ElementAssetGeneration): boolean;
  runtimeEffectFailure(error: unknown, fatal: boolean): void;
  runtimePresentationUnsupported(): void;
}

/** Applied-effect cache. It has no lane, waiters, callbacks, or desired state. */
export class ElementRuntimeEffects {
  readonly #layers: ShadowLayerOwner;
  readonly #router: BindingRouter;
  readonly #inputs: AutomaticInputs;
  readonly #state: ElementPublicState;
  readonly #stateCommand: ElementCommandSlot<ElementStateCommandKey>;
  readonly #resumeCommand: ElementCommandSlot<ElementResumeCommandKey>;
  #intrinsic: Readonly<IntrinsicSizeResult> | null = null;
  #metadataGeneration = 0;
  #visibility: string | null = null;
  #motion: string | null = null;
  #resize: string | null = null;
  #stateIntent: string | null = null;
  #pause: string | null = null;
  #resume: string | null = null;

  public constructor(input: Readonly<{
    layers: ShadowLayerOwner;
    router: BindingRouter;
    inputs: AutomaticInputs;
    state: ElementPublicState;
    stateCommand: ElementCommandSlot<ElementStateCommandKey>;
    resumeCommand: ElementCommandSlot<ElementResumeCommandKey>;
  }>) {
    this.#layers = input.layers;
    this.#router = input.router;
    this.#inputs = input.inputs;
    this.#state = input.state;
    this.#stateCommand = input.stateCommand;
    this.#resumeCommand = input.resumeCommand;
  }

  public async apply(
    snapshot: Readonly<ElementDesiredSnapshot>,
    asset: ElementAssetGeneration,
    configuration: Readonly<ElementConfiguration>,
    authority: ElementRuntimeEffectAuthority
  ): Promise<void> {
    if (!authority.runtimeEffectCurrent(snapshot, asset)) return;
    if (!this.presentation(snapshot, asset, configuration)) {
      authority.runtimePresentationUnsupported();
      return;
    }
    if (!authority.runtimeEffectCurrent(snapshot, asset)) return;
    try { await this.visibility(snapshot, asset); }
    catch (error) {
      if (authority.runtimeEffectCurrent(snapshot, asset)) {
        authority.runtimeEffectFailure(error, false);
      }
    }
    if (!authority.runtimeEffectCurrent(snapshot, asset)) return;
    try { await this.motion(snapshot, asset, configuration); }
    catch (error) {
      if (authority.runtimeEffectCurrent(snapshot, asset)) {
        authority.runtimeEffectFailure(error, false);
      }
    }
    if (!authority.runtimeEffectCurrent(snapshot, asset)) return;
    this.applyState(snapshot, asset, authority);
    if (!authority.runtimeEffectCurrent(snapshot, asset)) return;
    await this.applyPlay(snapshot, asset, authority);
  }

  public metadataReady(metadata: ElementSourceMetadata): void {
    this.#intrinsic = computeIntrinsicSize(metadata.canvas);
    this.#metadataGeneration = 0;
  }

  public resetAsset(): void {
    this.#router.install([]);
    this.#inputs.setRuntimeVisible(false);
    this.#inputs.metadataUnready();
    this.#intrinsic = null;
    this.#metadataGeneration = 0;
    this.clearApplied();
  }

  public clearApplied(): void {
    this.#visibility = null;
    this.#motion = null;
    this.#resize = null;
    this.#stateIntent = null;
    this.#pause = null;
    this.#resume = null;
  }

  public async visibility(
    snapshot: Readonly<ElementDesiredSnapshot>,
    asset: ElementAssetGeneration
  ): Promise<void> {
    const value = snapshot.effectivelyVisible ? "visible" : "hidden";
    const key = `${asset.generation}:${value}`;
    if (key === this.#visibility) return;
    if (value === "hidden") this.#inputs.setRuntimeVisible(false);
    this.#router.route(value);
    await asset.setVisibility(value);
    if (value === "visible") this.#inputs.setRuntimeVisible(true);
    this.#visibility = key;
  }

  public async motion(
    snapshot: Readonly<ElementDesiredSnapshot>,
    asset: ElementAssetGeneration,
    configuration: Readonly<ElementConfiguration>
  ): Promise<void> {
    const key = `${asset.generation}:${configuration.motion}:${String(snapshot.hostReducedMotion)}`;
    if (key === this.#motion) return;
    await asset.setMotionPolicy(configuration.motion, snapshot.hostReducedMotion);
    this.#motion = key;
  }

  public presentation(
    snapshot: Readonly<ElementDesiredSnapshot>,
    asset: ElementAssetGeneration,
    configuration: Readonly<ElementConfiguration>
  ): boolean {
    if (!snapshot.effectivelyVisible) this.#inputs.setRuntimeVisible(false);
    if (this.#metadataGeneration !== asset.generation && this.#intrinsic !== null) {
      this.#router.install(this.#state.inputBindings);
      this.#inputs.metadataReady();
      this.#metadataGeneration = asset.generation;
      this.#router.route(snapshot.effectivelyVisible ? "visible" : "hidden");
    }
    if (!applyIntrinsicSize(
      this.#layers,
      this.#intrinsic,
      configuration.width,
      configuration.height
    )) return false;
    if (snapshot.box.width <= 0 || snapshot.box.height <= 0) return true;
    const key = [
      asset.generation,
      snapshot.box.width,
      snapshot.box.height,
      snapshot.dpr,
      configuration.fit ?? "default"
    ].join(":");
    if (key !== this.#resize) {
      asset.resize({
        cssWidth: snapshot.box.width,
        cssHeight: snapshot.box.height,
        devicePixelRatio: snapshot.dpr,
        ...(configuration.fit === null ? {} : { fit: configuration.fit })
      });
      this.#resize = key;
    }
    return true;
  }

  public stateApplied(key: string): boolean { return this.#stateIntent === key; }
  public markStateApplied(key: string): void { this.#stateIntent = key; }

  public pause(asset: ElementAssetGeneration, playSequence: number): void {
    const key = `${asset.generation}:${playSequence}`;
    if (key === this.#pause) return;
    asset.pause();
    this.#pause = key;
  }

  public resumeApplied(asset: ElementAssetGeneration, playSequence: number): boolean {
    return this.#resume === `${asset.generation}:${playSequence}:visible`;
  }

  public markResumeApplied(asset: ElementAssetGeneration, playSequence: number): void {
    this.#resume = `${asset.generation}:${playSequence}:visible`;
  }

  applyState(
    snapshot: Readonly<ElementDesiredSnapshot>,
    asset: ElementAssetGeneration,
    authority: ElementRuntimeEffectAuthority
  ): void {
    const intent = snapshot.stateIntent;
    if (intent === null || this.#state.stateNames.length === 0) return;
    const intentName = intent.name ?? this.#state.initialState;
    if (intentName === null) return;
    const appliedKey = `${snapshot.sourceToken}:${intent.sequence}:${intent.name ?? "<initial>"}:${intentName}`;
    if (this.stateApplied(appliedKey)) return;
    const commandKey = Object.freeze({
      sourceToken: snapshot.sourceToken,
      name: intentName,
      sequence: intent.sequence
    });
    const publicCommand = this.#stateCommand.start(commandKey);
    if (!this.#state.stateNames.includes(intentName)) {
      const error = new TypeError(`unknown aval state: ${intentName}`);
      if (publicCommand) this.#stateCommand.reject(commandKey, error);
      else authority.runtimeEffectFailure("invalid-configuration", false);
      this.markStateApplied(appliedKey);
      return;
    }
    let operation: Promise<void>;
    try { operation = asset.setState(intentName); }
    catch (error) {
      if (publicCommand) this.#stateCommand.reject(commandKey, error);
      else if (!isExpectedAbort(error)) {
        authority.runtimeEffectFailure("invalid-configuration", false);
      }
      return;
    }
    this.markStateApplied(appliedKey);
    void Promise.resolve(operation).then(() => {
      if (publicCommand && authority.runtimeStateCurrent(commandKey, asset)) {
        this.#stateCommand.resolve(commandKey);
      }
    }, (error: unknown) => {
      if (!authority.runtimeSourceCurrent(snapshot.sourceToken)) return;
      if (publicCommand) this.#stateCommand.reject(commandKey, error);
      else if (!isExpectedAbort(error)) {
        authority.runtimeEffectFailure("invalid-configuration", false);
      }
    });
  }

  async applyPlay(
    snapshot: Readonly<ElementDesiredSnapshot>,
    asset: ElementAssetGeneration,
    authority: ElementRuntimeEffectAuthority
  ): Promise<void> {
    const key = Object.freeze({
      sourceToken: snapshot.sourceToken,
      playSequence: snapshot.playSequence
    });
    if (!snapshot.manualPlaying) {
      this.pause(asset, snapshot.playSequence);
      return;
    }
    const currentCommand = this.#resumeCommand.current();
    const pendingPublicCommand = currentCommand !== null &&
      resumeCommandIdentityEqual(currentCommand.key, key);
    const publicCommand = this.#resumeCommand.start(key) || pendingPublicCommand;
    const usable = this.#state.readiness === "interactiveReady" ||
      this.#state.readiness === "staticReady";
    if (!usable) return;
    if (!snapshot.effectivelyVisible) {
      if (publicCommand && authority.runtimeEffectCurrent(snapshot, asset)) {
        this.#resumeCommand.resolve(key);
      }
      return;
    }
    if (this.resumeApplied(asset, snapshot.playSequence)) {
      if (publicCommand) this.#resumeCommand.resolve(key);
      return;
    }
    if (!authority.runtimeResumeCurrent(key, asset)) return;
    try {
      await asset.resume();
      if (!authority.runtimeResumeCurrent(key, asset)) return;
      this.markResumeApplied(asset, snapshot.playSequence);
      if (publicCommand) this.#resumeCommand.resolve(key);
    } catch (error) {
      if (publicCommand && authority.runtimeSourceCurrent(key.sourceToken)) {
        this.#resumeCommand.reject(key, error);
      }
    }
  }
}

export function stateCommandIdentityEqual(
  left: ElementStateCommandKey,
  right: ElementStateCommandKey
): boolean {
  return left.sourceToken === right.sourceToken &&
    left.name === right.name && left.sequence === right.sequence;
}

export function resumeCommandIdentityEqual(
  left: ElementResumeCommandKey,
  right: ElementResumeCommandKey
): boolean {
  return left.sourceToken === right.sourceToken &&
    left.playSequence === right.playSequence;
}
