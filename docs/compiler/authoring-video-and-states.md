# Preparing video and authoring states

An `.avl` is a compiled asset: it contains encoded animation units, timing,
integrity hashes, and a declarative state graph. It contains no poster or
static-image payload. A site does not ship the original `.mov`, `.mp4`, `.m4v`,
or PNG sequence alongside it unless
that source is needed for some unrelated purpose.

The source media contains pixels and timing. State names do not live inside the
video. You assign source-frame ranges to units and transitions, then define
states and application bindings in `motion.json`; the compiler packages all of
that into the `.avl`.

## Prepare source media

The compiler accepts:

- `.mov`, `.mp4`, and `.m4v` video files; and
- numbered RGBA PNG sequences such as `frame-0000.png`, `frame-0001.png`, and
  so on.

WebM source containers are not accepted in project `0.3`. This is independent
of codec support: FFmpeg may decode HEVC, VP9, or AV1 carried by one of the
accepted input containers, while compiled AVAL output remains H.264.

For predictable results, prepare every source with:

- one video stream and no required audio stream;
- progressive frames, not interlaced fields;
- square pixels (`1:1` sample aspect ratio);
- rotation baked into the pixels and rotation metadata cleared;
- a constant frame rate matching the project when using `exact` timing; and
- the same aspect ratio as the project canvas.

Inspect a video before authoring ranges:

```sh
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_aspect_ratio,field_order:stream_tags=rotate \
  -of json source.mov
```

If you deliberately need to convert a source, choose the output dimensions
yourself. This example creates a progressive, square-pixel, 30 fps opaque
editing source without asking the AVAL compiler to choose a size:

```sh
ffmpeg -i source.mov -an \
  -vf "fps=30,setsar=1,format=yuv444p10le" \
  -metadata:s:v:0 rotate=0 \
  -c:v prores_ks -profile:v 3 prepared.mov
```

For native transparency, use an input codec/pixel format that actually carries
alpha, such as ProRes 4444 in a `.mov`, or use an RGBA PNG sequence:

```sh
ffmpeg -i source-with-alpha.mov -an \
  -vf "fps=30,setsar=1,format=yuva444p10le" \
  -metadata:s:v:0 rotate=0 \
  -c:v prores_ks -profile:v 4 prepared-alpha.mov
```

Do not use H.264 as an intermediate when transparency matters; ordinary H.264
does not preserve an alpha channel. The project `profile` chooses opaque,
packed-alpha, or automatic source-alpha handling.

Use the highest-quality source available because compilation always encodes new
H.264 units. For opaque work, prefer ProRes 422 HQ, DNxHR HQX, FFV1, or an RGBA
PNG sequence. For transparency, prefer ProRes 4444 or RGBA PNGs. FFmpeg may
decode H.264, HEVC, VP9, or AV1 input, but transcoding an already compressed
delivery file cannot recover information that was previously discarded.

For the direct-input shorthand, select capped CRF and an allowlisted preset:

```sh
avl compile input.mov --out motion.avl --loop 0:120 \
  --crf 20 --max-bitrate 10000000 --preset slow
```

CRF is an integer from `1` through `51`; lower values normally increase H.264
quality and size. An x265 CRF number is not equivalent to the same x264 number.
Use `--bitrate average:peak` instead of `--crf` when ABR is required. Packed
alpha is validated after decode and can need a substantially lower CRF than
opaque video; a quality-gate failure means you should lower CRF or use ABR,
not disable the validation.

## Choose timing explicitly

Use `exact` for a constant-frame-rate source already on the project frame grid:

```json
{
  "id": "loops",
  "type": "video",
  "path": "loops.mov",
  "timing": { "mode": "exact" }
}
```

Use `normalize-hold` only when you intentionally want variable source timing
mapped to the project grid by holding the latest source frame:

```json
{
  "id": "shift",
  "type": "video",
  "path": "shift.m4v",
  "timing": { "mode": "normalize-hold" }
}
```

For PNGs, declare the filename grammar and exact count. The compiler resolves
only those names; unrelated files in the directory are ignored:

```json
{
  "id": "frames",
  "type": "png-sequence",
  "directory": "frames",
  "prefix": "frame-",
  "digits": 4,
  "suffix": ".png",
  "firstNumber": 0,
  "frameCount": 240
}
```

All project ranges are zero-based, integral, and half-open. `[30, 45]` includes
source frames 30 through 44 and therefore contains 15 frames. Use FFprobe or an
editing timeline to record exact frame boundaries before writing the project.

## Review visual seams without rewriting the source

For an explicit `motion.json` project, your frame ranges and source pixels are
authoritative. The compiler analyzes every loop, departure, and arrival in
linear-light premultiplied RGBA. A boundary outside the automatic heuristic is
published with `status: "review"` in the build report and a CLI warning; it does
not block compilation, blend frames, or otherwise change the video.

`continuity: "exact-authored"` is the author's declaration that the connected
frames form the intended visual route. The numerical check helps find likely
mistakes, but it cannot determine semantic naturalness. Inspect each review
warning and the local playback before shipping. An identical endpoint amid
surrounding motion is also reported for review because it can create a one-frame
pause.

The direct single-loop shorthand remains stricter because it creates the graph
on the author's behalf. If that shorthand rejects a deliberately authored
boundary, describe the ranges and states in a project instead.

## Complete multi-state project

This example uses one video for two looping bodies and another for the
reversible transition. The state graph and binding names are compiler input;
they are not embedded in either video:

```json
{
  "projectVersion": "0.3",
  "profile": "avc-annexb-auto-v1",
  "canvas": {
    "width": 1920,
    "height": 1080,
    "fit": "contain",
    "pixelAspect": [1, 1],
    "colorSpace": "srgb"
  },
  "frameRate": { "numerator": 30, "denominator": 1 },
  "renditions": [
    {
      "id": "avc.1x",
      "width": 1920,
      "height": 1080,
      "encoding": {
        "codec": "h264",
        "preset": "slow",
        "rateControl": {
          "mode": "crf",
          "crf": 20,
          "maxBitrate": 10000000
        }
      }
    }
  ],
  "sources": [
    {
      "id": "loops",
      "type": "video",
      "path": "loops.mov",
      "timing": { "mode": "exact" }
    },
    {
      "id": "shift",
      "type": "video",
      "path": "shift.mov",
      "timing": { "mode": "exact" }
    }
  ],
  "units": [
    {
      "id": "idle.body",
      "kind": "body",
      "source": "loops",
      "range": [0, 30],
      "playback": "loop",
      "ports": [
        { "id": "default", "entryFrame": 0, "portalFrames": [0] }
      ]
    },
    {
      "id": "engage.shift",
      "kind": "reversible",
      "source": "shift",
      "range": [0, 15],
      "residency": {
        "endpoints": [
          { "state": "idle", "port": "default", "frames": 6 },
          { "state": "engaged", "port": "default", "frames": 6 }
        ]
      }
    },
    {
      "id": "engaged.body",
      "kind": "body",
      "source": "loops",
      "range": [30, 60],
      "playback": "loop",
      "ports": [
        { "id": "default", "entryFrame": 0, "portalFrames": [0] }
      ]
    }
  ],
  "initialState": "idle",
  "states": [
    {
      "id": "idle",
      "bodyUnit": "idle.body"
    },
    {
      "id": "engaged",
      "bodyUnit": "engaged.body"
    }
  ],
  "edges": [
    {
      "id": "idle.engaged",
      "from": "idle",
      "to": "engaged",
      "trigger": { "type": "event", "name": "control.engage" },
      "start": {
        "type": "portal",
        "sourcePort": "default",
        "targetPort": "default",
        "maxWaitFrames": 12
      },
      "transition": {
        "kind": "reversible",
        "unit": "engage.shift",
        "direction": "forward"
      },
      "continuity": "exact-authored"
    },
    {
      "id": "engaged.idle",
      "from": "engaged",
      "to": "idle",
      "trigger": { "type": "event", "name": "control.release" },
      "start": {
        "type": "portal",
        "sourcePort": "default",
        "targetPort": "default",
        "maxWaitFrames": 12
      },
      "transition": {
        "kind": "reversible",
        "unit": "engage.shift",
        "direction": "reverse",
        "reverseOf": "idle.engaged"
      },
      "continuity": "exact-reverse"
    }
  ],
  "bindings": [
    { "source": "engagement.on", "event": "control.engage" },
    { "source": "engagement.off", "event": "control.release" }
  ]
}
```

The project canvas and every rendition size are authoritative. The compiler
does not downscale, shorten, sample, or invent a smaller rendition. A source may
be larger than the canvas only when your project explicitly chooses that
canvas, making the resize an authored operation.

Large assets can require substantial RAM, temporary disk, encode time, network
transfer, decoder memory, and GPU texture capacity. Representational and checked
arithmetic validation still applies. FFmpeg, allocation, WebCodecs, WebGL, or an
explicit host policy may reject an asset that exceeds the actual machine or
browser. That failure is reported; the compiler/player does not retry smaller.

## Compile, inspect, validate, and develop

From this repository:

```sh
npm run avl -- compile motion.json --out public/motion.avl
npm run avl -- inspect public/motion.avl
npm run avl -- validate public/motion.avl
npm run avl -- dev motion.json --out public/motion.avl --open
```

For an installed package, use the same subcommands through `npx avl`.
Compilation needs FFmpeg/FFprobe; browser playback does not.

## End-user integration

The application needs the compiled `.avl` and one element registration import.
The remaining code is ordinary JavaScript in the application's framework:

```js
import { defineAvalElement } from "@pixel-point/aval-element";

defineAvalElement();

const motion = document.querySelector("aval-player");
await motion?.setState("engaged");
```

```html
<aval-player src="/motion.avl" state="idle">
  <img slot="fallback" src="/motion.png" alt="">
</aval-player>
```

That optional image belongs to the application HTML. It is never copied into
the `.avl`; supported playback reveals a decoded motion frame instead.

See the permanent [end-user playground](../../examples/end-user-playground/README.md)
for a complete local consumer page using only public APIs.
