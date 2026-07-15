import type { AvalElement } from "@pixel-point/aval-element";
import { createRef } from "react";

const motion = createRef<AvalElement>();

void (
  <aval-player
    ref={motion}
    src="/status.avl"
    state="loading"
    motion="reduce"
    autoplay="manual"
    fit="contain"
    bindings="none"
    width={160}
    height="160"
    aria-label="Decorative status motion"
  />
);

void (
  // @ts-expect-error motion remains a closed public union in JSX
  <aval-player motion="sometimes" />
);

void (
  // @ts-expect-error object interaction targets are assigned through a ref
  <aval-player interactionTarget={document.body} />
);
