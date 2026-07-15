import {
  installDecoderWorker,
  type DecoderWorkerMessagePort
} from "@pixel-point/aval-player-web";

installDecoderWorker(self as unknown as DecoderWorkerMessagePort, {
  supportProbe: async (config) => ({ supported: false, config })
});
