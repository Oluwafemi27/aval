# @pixel-point/aval-compiler

Authoring API and `avl` CLI for project schema `0.3` and compiled wire format
`0.1`. The compiler uses caller-installed FFmpeg/FFprobe and libx264; no native
codec tool is bundled or downloaded.

Install it as a development dependency before invoking its local `avl` binary:

```sh
npm install --save-dev @pixel-point/aval-compiler@1.0.0
npx avl init my-motion
```

See the repository [compiler guide](../../docs/compiler.md) and
[video/state authoring guide](../../docs/compiler/authoring-video-and-states.md).
