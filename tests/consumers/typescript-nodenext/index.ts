import { defineAvalElement, type AvalElement } from "@aval/element";
import { parseFrontIndex } from "@aval/format";
import type { MotionGraphDefinition } from "@aval/graph";
import type { IntegratedPlayer } from "@aval/player-web";

defineAvalElement();
const parse: typeof parseFrontIndex = parseFrontIndex;
const element: AvalElement | null = null;
const graph: MotionGraphDefinition | null = null;
const player: IntegratedPlayer | null = null;
void [parse, element, graph, player];

// @ts-expect-error source-private paths are not public package API.
import("@aval/player-web/src/runtime/page-resource-manager.js");
