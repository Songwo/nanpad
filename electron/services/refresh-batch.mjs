/** 合并同类批次；人工刷新遇到自动批次时，补一次强制刷新而不丢失用户意图。 */
export function createRefreshBatch(run) {
  let current = null;
  let forcedFollowup = null;
  function refresh(force = false) {
    if (current) {
      if (!force || current.force) return current.promise;
      if (!forcedFollowup)
        forcedFollowup = current.promise
          .catch(() => {})
          .then(() => {
            forcedFollowup = null;
            return refresh(true);
          });
      return forcedFollowup;
    }
    const job = { force, promise: null };
    job.promise = Promise.resolve()
      .then(() => run(force))
      .finally(() => {
        if (current === job) current = null;
      });
    current = job;
    return job.promise;
  }
  return refresh;
}
