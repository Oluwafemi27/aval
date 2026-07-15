import * as graph from "@aval/graph";
import * as format from "@aval/format";
import * as compiler from "@aval/compiler";
import * as playerWeb from "@aval/player-web";
import * as element from "@aval/element";

for (const [name, module] of Object.entries({ graph, format, compiler, playerWeb, element })) {
  if (Object.keys(module).length === 0) throw new Error(`${name} has no public exports`);
}
if (typeof element.defineAvalElement !== "function") throw new Error("element root has no definition helper");
process.stdout.write("node-esm-consumer:passed\n");
