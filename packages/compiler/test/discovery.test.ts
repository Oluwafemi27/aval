import { describe, expect, it } from "vitest";

import { createCalibrationInvocation } from "../src/ffmpeg/discovery.js";

describe("FFmpeg discovery calibration policy", () => {
  it("pins calibration to the explicit legacy medium ABR encoder vector", () => {
    const arguments_ = createCalibrationInvocation().arguments;

    expect(arguments_).toEqual(expect.arrayContaining([
      "-c:v", "libx264",
      "-preset", "medium",
      "-tune", "zerolatency",
      "-b:v", "300000",
      "-maxrate", "600000",
      "-bufsize", "600000"
    ]));
    expect(arguments_).not.toContain("-crf");
  });
});
