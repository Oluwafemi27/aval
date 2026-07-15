export {
  defineAvalElement,
  AVAL_TAG_NAME
} from "@aval/element";

export async function importAvalAuto(): Promise<void> {
  await import("@aval/element/auto");
}
