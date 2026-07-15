# React integration

Use the custom tag for reflected configuration and a typed ref for methods,
object targets, and custom events. No React wrapper is required.

The runnable example at `examples/react-ref` pins its React, TypeScript, and
Vite versions. Once the workspace packages are available locally, install the
exact element release alongside the example dependencies, then typecheck and
build it:

```sh
cd examples/react-ref
npm install @pixel-point/aval-element@1.0.0
npm run typecheck
npm run build
```

The repository release gate substitutes the exact packed local element
tarball for that install. This document does not claim that version 1.0.0 is
already available from a public registry.

```tsx
import { useEffect, useRef } from "react";
import {
  defineAvalElement,
  type AvalElement
} from "@pixel-point/aval-element";

export function StatusMotion({
  state,
  onVisualState
}: {
  state: string;
  onVisualState?: (state: string | null) => void;
}) {
  const ref = useRef<AvalElement>(null);
  useEffect(() => {
    defineAvalElement();
    const node = ref.current;
    if (!node) return;
    const listener = () => onVisualState?.(node.visualState);
    node.addEventListener("visualstatechange", listener);
    return () => node.removeEventListener("visualstatechange", listener);
  }, [onVisualState]);
  return (
    <aval-player ref={ref} src="/status.avl" state={state}>
      <span slot="fallback" aria-hidden="true">{state}</span>
    </aval-player>
  );
}
```

Putting definition inside the client effect keeps server rendering free of DOM
global access. Assign an object-only target in a separate effect when needed:

```tsx
useEffect(() => {
  if (ref.current) ref.current.interactionTarget = buttonRef.current;
  return () => {
    if (ref.current) ref.current.interactionTarget = null;
  };
}, []);
```

Add this local declaration to a `.d.ts` file included by your TypeScript
configuration. It combines normal React HTML/ARIA/ref props with the element's
closed public attribute contract:

```ts
import type {
  AvalElement,
  AvalElementAttributes
} from "@pixel-point/aval-element";
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type AvalReactProps = DetailedHTMLProps<
  HTMLAttributes<AvalElement>,
  AvalElement
> & AvalElementAttributes;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "aval-player": AvalReactProps;
    }
  }
}
```

Keep custom DOM events on `addEventListener`; React custom-event prop naming is
not the element contract. Do not mirror every visual-state event back into a
controlled `state` prop; application semantics should own that prop. Keep the
author-owned slotted fallback in the JSX so the page remains useful before
registration, without JavaScript, and after a fatal asset failure.
