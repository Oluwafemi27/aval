import { defineAvalElement, type AvalElement } from "@pixel-point/aval-element";
import { parseFrontIndex } from "@pixel-point/aval-format";
import type { MotionGraphDefinition } from "@pixel-point/aval-graph";
import type { IntegratedPlayer } from "@pixel-point/aval-player-web";

defineAvalElement();
const parse: typeof parseFrontIndex = parseFrontIndex;
const element: AvalElement | null = null;
const graph: MotionGraphDefinition | null = null;
const player: IntegratedPlayer | null = null;
void [parse, element, graph, player];

// @ts-expect-error source-private paths are not public package API.
import("@pixel-point/aval-player-web/src/runtime/page-resource-manager.js");
