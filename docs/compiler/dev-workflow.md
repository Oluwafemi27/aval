# Local watch workflow

```sh
avl dev motion.json --out motion.avl
```

The watcher debounces bursts for 100 ms and runs one abortable compile at a
time. A failed edit never replaces the last validated asset. A successful edit
atomically publishes new bytes and updates the browser with a cache-busted
source URL, exercising real element generation cleanup.

The loopback page registers the public element itself and provides discovered
state/event controls, motion/autoplay/binding/fit/size controls, source
replacement, multi-player stress, compiler summaries, and bounded public
diagnostics. Open it explicitly when desired:

```sh
avl dev motion.json --out motion.avl --open
```

Development servers bind loopback. They do not accept uploads, expose source
files, weaken validation, or send telemetry. Opening a browser is opt-in.
