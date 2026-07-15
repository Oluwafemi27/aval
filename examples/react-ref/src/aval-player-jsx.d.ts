import type {
  AvalElement,
  AvalElementAttributes
} from "@aval/element";
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
