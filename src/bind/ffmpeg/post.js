if (typeof PThread !== "undefined") {
  Module["PThread"] = PThread;
  Module["prewarmPool"] = async function (targetSize) {
    if (typeof ENVIRONMENT_IS_PTHREAD !== "undefined" && ENVIRONMENT_IS_PTHREAD) return;
    const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
    const target = targetSize || Math.min(Math.max(Math.round(cores * 2.5 + 2), 16), 64);
    while (PThread.unusedWorkers.length < target) {
      const batchSize = Math.min(4, target - PThread.unusedWorkers.length);
      const batch = [];
      for (let i = 0; i < batchSize; i++) {
        const worker = PThread.allocateUnusedWorker();
        batch.push(PThread.loadWasmModuleToWorker(worker));
      }
      await Promise.all(batch);
      await new Promise(function (resolve) { setTimeout(resolve, 0); });
    }
  };
}
