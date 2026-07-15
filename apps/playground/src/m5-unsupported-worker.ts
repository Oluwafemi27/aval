import {
  installDecoderWorker,
  type DecoderWorkerMessagePort
} from "@aval/player-web";

installDecoderWorker(self as unknown as DecoderWorkerMessagePort, {
  supportProbe: async (config) => ({ supported: false, config })
});
