import { useEffect, useRef } from "react";
import {
  defineAvalElement,
  type AvalElement,
  type AvalErrorDetail,
  type AvalVisualStateChangeDetail
} from "@aval/element";

export interface StatusMotionProps {
  readonly state: string;
  readonly src: string;
  readonly onError?: (failure: Readonly<AvalErrorDetail>) => void;
  readonly onVisualState?: (state: string | null) => void;
}

export function StatusMotion({
  state,
  src,
  onError,
  onVisualState
}: StatusMotionProps) {
  const motion = useRef<AvalElement>(null);

  useEffect(() => {
    defineAvalElement();
    const element = motion.current;
    if (element === null) return;

    const handleError = (event: CustomEvent<Readonly<AvalErrorDetail>>) => {
      onError?.(event.detail);
    };
    const handleVisualState = (
      event: CustomEvent<Readonly<AvalVisualStateChangeDetail>>
    ) => {
      onVisualState?.(event.detail.to);
    };
    element.addEventListener("error", handleError);
    element.addEventListener("visualstatechange", handleVisualState);
    return () => {
      element.removeEventListener("error", handleError);
      element.removeEventListener("visualstatechange", handleVisualState);
    };
  }, [onError, onVisualState]);

  return (
    <aval-player
      ref={motion}
      src={src}
      state={state}
      width={160}
      height={160}
      aria-hidden="true"
    >
      <span slot="fallback" className="motion-fallback" aria-hidden="true">
        {state}
      </span>
    </aval-player>
  );
}
