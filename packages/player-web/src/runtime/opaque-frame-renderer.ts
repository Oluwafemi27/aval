/** @deprecated Import the profile-neutral frame renderer instead. */
export {
  FRAME_STREAMING_SLOT_COUNT as OPAQUE_STREAMING_SLOT_COUNT,
  LegacyOpaqueFrameRenderer as OpaqueFrameRenderer,
  RendererDisposedError,
  RendererFrameUnavailableError,
  RendererUnavailableError,
  RendererUploadTimeoutError
} from "./frame-renderer.js";

export type {
  BorrowedVideoFrame,
  CopyableVideoFrame,
  FrameRendererBackendLimits as OpaqueFrameRendererBackendLimits,
  FrameRendererOptions as OpaqueFrameRendererOptions,
  FrameRendererSnapshot as OpaqueFrameRendererSnapshot,
  FrameRendererState,
  FrameRendererTimerHost as OpaqueFrameRendererTimerHost,
  FrameTextureKind as OpaqueTextureKind,
  LegacyOpaqueFrameRendererBackend as OpaqueFrameRendererBackend,
  LegacyOpaqueFrameTextureLayout as OpaqueFrameTextureLayout,
  RenderFrameHandle,
  ResidentFrameHandle,
  StreamingFrameHandle
} from "./frame-renderer.js";
