import { createCachedResource } from "./cached-resource.mjs";

/** 监听采集完成事件；仅状态变化时复用统计，不重新读取历史或触发采集。
 * @param {() => import('./usage').UsageBridge | undefined} getApi
 * @param {{maxAge?:number, now?:()=>number}} options
 */
export function createUsageResource(getApi, options = {}) {
  /** @type {import('./usage').UsageBridge | undefined} */
  let subscribed;
  /** @type {(() => void) | undefined} */
  let unsubscribe;
  /** @type {import('./usage').LocalUsageStatus | undefined} */
  let latestStatus;
  let statusVersion = 0;
  /** @type {Set<(recordsChanged:boolean) => void>} */
  const listeners = new Set();
  const cache = createCachedResource(async () => {
    const api = getApi();
    if (!api) throw new Error("用量统计仅桌面端可用。");
    const version = statusVersion;
    const [data, status] = await Promise.all([api.list(), api.localStatus()]);
    if (version === statusVersion) latestStatus = status;
    return { data, status };
  }, options);
  function connect() {
    const api = getApi();
    if (api === subscribed) return;
    unsubscribe?.();
    subscribed = api;
    latestStatus = undefined;
    cache.invalidate();
    unsubscribe = api?.onChanged?.((change) => {
      if (change?.localStatus) {
        latestStatus = change.localStatus;
        statusVersion++;
      }
      if (change?.recordsChanged !== false) cache.invalidate();
      for (const listener of listeners) listener(change?.recordsChanged !== false);
    });
  }
  return {
    peek() {
      connect();
      const value = cache.peek();
      return value && latestStatus ? { ...value, status: latestStatus } : value;
    },
    async read(force = false) {
      connect();
      const value = await cache.read(force);
      return latestStatus ? { ...value, status: latestStatus } : value;
    },
    invalidate: cache.invalidate,
    /** @param {(recordsChanged:boolean) => void} listener */
    subscribe(listener) {
      connect();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
