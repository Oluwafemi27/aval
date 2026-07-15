export {
  defineAvalElement,
  AVAL_TAG_NAME
} from "@pixel-point/aval-element";

export async function importAvalAuto(): Promise<void> {
  await import("@pixel-point/aval-element/auto");
}
