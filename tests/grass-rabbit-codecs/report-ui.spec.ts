import { expect, test } from "@playwright/test";

import {
  CODECS,
  CODEC_LABELS,
  codecPanel,
  type Codec
} from "./support/browser-harness.js";

const COMPILE_COMMAND =
  "avl compile motion.json --out public/grass-rabbit --force";

const EXPECTED_ENCODINGS = Object.freeze({
  av1: Object.freeze({
    crf: 48,
    policy: Object.freeze({
      bitDepth: 10,
      cpuUsed: 0,
      tiles: Object.freeze({ columns: 4, rows: 2 }),
      rowMt: true,
      threads: 32
    })
  }),
  vp9: Object.freeze({
    crf: 44,
    policy: Object.freeze({ deadline: "best", cpuUsed: 0, threads: 8 })
  }),
  h265: Object.freeze({
    crf: 34,
    policy: Object.freeze({ preset: "veryslow", threads: 8 })
  }),
  h264: Object.freeze({
    crf: 30,
    policy: Object.freeze({ preset: "veryslow" })
  })
} as const);

interface BuildAsset {
  readonly codec: Codec;
  readonly path: string;
  readonly bytes: number;
  readonly codecString: string;
}

interface BuildEncoding {
  readonly codec: Codec;
  readonly renditions: readonly Readonly<{
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly crf: number;
  }>[];
  readonly [key: string]: unknown;
}

interface BuildReport {
  readonly reportVersion: string;
  readonly assets: readonly Readonly<BuildAsset>[];
  readonly encodings: readonly Readonly<BuildEncoding>[];
  readonly invocations: readonly Readonly<{
    readonly tool: string;
    readonly operation: string;
    readonly arguments: readonly string[];
  }>[];
}

test("renders exact report-backed build details for every codec", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const report = await page.evaluate(async (): Promise<BuildReport> => {
    const response = await fetch("/grass-rabbit/build.json", {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(
        `build report request failed (${String(response.status)})`
      );
    }
    return response.json() as Promise<BuildReport>;
  });
  expect(report.reportVersion).toBe("1.0");
  expect(report.assets.map(({ codec }) => codec)).toEqual(CODECS);
  expect(report.encodings.map(({ codec }) => codec)).toEqual(CODECS);
  const assets = new Map(report.assets.map((asset) => [asset.codec, asset]));
  const encodings = new Map(report.encodings.map((encoding) => [
    encoding.codec,
    encoding
  ]));

  for (const codec of CODECS) {
    const panel = codecPanel(page, codec);
    const details = panel.locator(".encoding-card");
    const asset = requireMapValue(assets, codec);
    const encoding = requireMapValue(encodings, codec);
    const expected = EXPECTED_ENCODINGS[codec];

    await expect(details).toHaveAttribute(
      "aria-label",
      `${CODEC_LABELS[codec]} encoding details`
    );
    expect(asset.path).toBe(`${codec}.avl`);
    await expect(details.locator('[data-field="asset-name"]'))
      .toHaveText(asset.path);
    const byteCount = details.locator('[data-field="asset-bytes"]');
    await expect(byteCount).toHaveAttribute("data-bytes", String(asset.bytes));
    await expect(byteCount).toContainText(`${formatInteger(asset.bytes)} bytes`);
    await expect(details.locator('[data-field="codec-string"]'))
      .toHaveText(asset.codecString);

    const encodingNode = details.locator("[data-encoding]");
    await expect(encodingNode).not.toHaveText("Loading build report…");
    const renderedEncoding = JSON.parse(
      await encodingNode.textContent() ?? "null"
    ) as unknown;
    expect(renderedEncoding).toEqual(encoding);
    expect(encoding).toMatchObject({
      codec,
      ...expected.policy,
      renditions: [{ width: 1280, height: 720, crf: expected.crf }]
    });

    await expect(details.locator("h4").filter({
      hasText: "Compiler command"
    })).toHaveCount(1);
    await expect(details.getByText(COMPILE_COMMAND, { exact: true }))
      .toHaveCount(1);

    const ffmpeg = details.locator("[data-ffmpeg]");
    await expect(ffmpeg).not.toHaveText("Loading build report…");
    expect(await ffmpeg.evaluate((node) =>
      node.previousElementSibling?.textContent?.trim() ?? null
    )).toBe("Representative compiler FFmpeg pipeline");
    const command = await ffmpeg.textContent() ?? "";
    const prefix = `${codec}:`;
    const invocations = report.invocations.filter((invocation) =>
      invocation.operation.startsWith(prefix) &&
      (invocation.operation.endsWith(":scale-rgba") ||
        invocation.operation.endsWith(":encode"))
    );
    expect(invocations.length).toBeGreaterThanOrEqual(2);
    expect(command).toBe(formatRepresentativeInvocations(invocations));
  }

  await expect(page.locator(".build-note").getByText(COMPILE_COMMAND, {
    exact: true
  })).toHaveCount(1);
});

function formatRepresentativeInvocations(
  invocations: BuildReport["invocations"]
): string {
  const scale = invocations.find(({ operation }) =>
    operation.endsWith(":scale-rgba")
  );
  const encode = invocations.find(({ operation }) =>
    operation.endsWith(":encode")
  );
  if (scale === undefined || encode === undefined) {
    throw new Error("representative FFmpeg invocations are missing");
  }
  return [scale, encode].map((invocation) => [
    `# ${invocation.operation}`,
    [invocation.tool, ...invocation.arguments]
      .map((value) => /^[A-Za-z0-9_./,:=+@%-]+$/u.test(value)
        ? value
        : `'${value.replaceAll("'", `'\\''`)}'`)
      .join(" \\\n  ")
  ].join("\n")).join("\n\n");
}

function requireMapValue<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  expect(value).toBeDefined();
  return value!;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
    .format(value);
}
