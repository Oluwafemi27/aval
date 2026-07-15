import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  encodeCanonicalRgbaPng
} from "../../../../packages/compiler/dist/compile/png.js";
import {
  FRAME_BACKGROUNDS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  taggedFrame
} from "./frame-fixtures.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const opaqueRoot = resolve(root, "opaque-frames");
const packedRoot = resolve(root, "packed-frames");

await Promise.all([
  rm(opaqueRoot, { recursive: true, force: true }),
  rm(packedRoot, { recursive: true, force: true })
]);
await Promise.all([
  mkdir(opaqueRoot, { recursive: true }),
  mkdir(packedRoot, { recursive: true })
]);

await Promise.all(FRAME_BACKGROUNDS.map(async (background, frameIndex) => {
  const file = `frame-${String(frameIndex).padStart(4, "0")}.png`;
  await writeFile(
    resolve(packedRoot, file),
    encodeCanonicalRgbaPng({
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      rgba: taggedFrame(background, frameIndex, true)
    })
  );
  await writeFile(
    resolve(opaqueRoot, file),
    encodeCanonicalRgbaPng({
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      rgba: taggedFrame(background, frameIndex, false)
    })
  );
}));
