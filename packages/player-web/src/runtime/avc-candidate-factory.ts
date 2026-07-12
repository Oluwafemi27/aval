import type {
  IntegratedCandidateAttempt,
  IntegratedCandidateAttemptContext,
  IntegratedCandidateFactory
} from "./integrated-player-contracts.js";
import { AvcCandidateAttempt } from "./avc-candidate-factory-attempt.js";
import type { AvcCandidateFactoryOptions } from "./avc-candidate-factory-model.js";
import { validateAvcCandidateFactoryOptions } from "./avc-candidate-factory-support.js";
import { validateAvcCandidateAttemptContext } from "./avc-candidate-factory-validation.js";
import { captureRuntimeCanvasResourceHost } from "./static-resource-plan.js";

export type {
  AvcCandidateWorkerSetup,
  AvcCandidateActivationInput,
  AvcCandidateCachePreparer,
  AvcCandidateFactoryOptions,
  AvcCandidatePreparedMedia,
  AvcCandidateReadinessFactory,
  AvcCandidateReadinessSession,
  AvcCandidateReadinessSessionInput,
  AvcCandidateRendererFactory,
  AvcCandidateRendererReservation,
  AvcCandidateTimerHost,
  AvcCandidateWorker,
  AvcCandidateWorkerFactory,
  OpaqueCandidateActivationInput,
  OpaqueCandidateCachePreparer,
  OpaqueCandidateFactoryOptions,
  OpaqueCandidatePreparedMedia,
  OpaqueCandidateReadinessFactory,
  OpaqueCandidateReadinessSession,
  OpaqueCandidateReadinessSessionInput,
  OpaqueCandidateRendererFactory,
  OpaqueCandidateRendererReservation,
  OpaqueCandidateTimerHost,
  OpaqueCandidateWorker,
  OpaqueCandidateWorkerFactory,
  OpaqueCandidateWorkerSetup
} from "./avc-candidate-factory-model.js";
export {
  createAvcCandidateWorkerSetup,
  createOpaqueCandidateWorkerSetup
} from "./avc-candidate-factory-config.js";

/**
 * Concrete profile-neutral AVC composition root. Effects stay injected, while ordering,
 * budgets, generations, the sole readiness run, and ownership stay here.
 */
export class AvcCandidateFactory implements IntegratedCandidateFactory {
  readonly #options: Readonly<AvcCandidateFactoryOptions>;
  #workerOwner: symbol | null = null;

  public readonly availability: IntegratedCandidateFactory["availability"];
  public readonly resourceHost?: NonNullable<
    IntegratedCandidateFactory["resourceHost"]
  >;

  public constructor(options: Readonly<AvcCandidateFactoryOptions>) {
    const capturedOptions = captureAvcCandidateFactoryOptions(options);
    validateAvcCandidateFactoryOptions(capturedOptions);
    this.#options = capturedOptions;
    if (capturedOptions.resourceHost !== undefined) {
      this.resourceHost = capturedOptions.resourceHost;
    }
    this.availability = Object.freeze({
      workerAvailable: capturedOptions.workerFactory.available,
      rendererAvailable: capturedOptions.rendererFactory.available
    });
  }

  public create(
    context: Readonly<IntegratedCandidateAttemptContext>
  ): IntegratedCandidateAttempt {
    validateAvcCandidateAttemptContext(context);
    const owner = Symbol("avc-candidate-attempt");
    return new AvcCandidateAttempt({
      context,
      factoryOptions: this.#options,
      owner,
      acquireWorker: () => {
        if (this.#workerOwner !== null) {
          throw new RangeError(
            "only one AVC candidate decoder worker may be alive"
          );
        }
        this.#workerOwner = owner;
      },
      releaseWorker: () => {
        if (this.#workerOwner === owner) this.#workerOwner = null;
      }
    });
  }
}

function captureAvcCandidateFactoryOptions(
  options: Readonly<AvcCandidateFactoryOptions>
): Readonly<AvcCandidateFactoryOptions> {
  if (options === null || typeof options !== "object") {
    throw new TypeError("AVC candidate factory options must be an object");
  }
  const workerFactory = options.workerFactory;
  const rendererFactory = options.rendererFactory;
  const readinessFactory = options.readinessFactory;
  const clock = options.clock;
  const timers = options.timers;
  const prepareCache = options.prepareCache;
  const rawResourceHost = options.resourceHost;
  const resourceHost = rawResourceHost === undefined
    ? undefined
    : captureRuntimeCanvasResourceHost(rawResourceHost);
  return Object.freeze({
    workerFactory,
    rendererFactory,
    readinessFactory,
    ...(resourceHost === undefined ? {} : { resourceHost }),
    ...(clock === undefined ? {} : { clock }),
    ...(timers === undefined ? {} : { timers }),
    ...(prepareCache === undefined ? {} : { prepareCache })
  });
}

/** @deprecated Use AvcCandidateFactory. */
export { AvcCandidateFactory as OpaqueCandidateFactory };
