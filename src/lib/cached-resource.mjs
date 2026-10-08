/** 带失效控制的内存缓存。旧快照可立即展示；重复请求共用同一任务。
 * @template T
 * @param {() => Promise<T>} loader
 * @param {{maxAge?:number, now?:()=>number}} options
 */
export function createCachedResource(loader, { maxAge = 10000, now = Date.now } = {}) {
  /** @type {T | undefined} */
  let value;
  let updated = -Infinity;
  let generation = 0;
  /** @type {Promise<T> | null} */
  let pending = null;
  function invalidate() {
    generation++;
    updated = -Infinity;
  }
  /** @param {boolean} force @returns {Promise<T>} */
  async function read(force = false) {
    if (force) invalidate();
    if (pending) {
      const result = await pending;
      return updated === -Infinity ? read() : result;
    }
    if (value !== undefined && now() - updated < maxAge) return value;
    const version = generation;
    pending = Promise.resolve()
      .then(loader)
      .then((next) => {
        if (version === generation) {
          value = next;
          updated = now();
        }
        return next;
      })
      .finally(() => {
        pending = null;
      });
    const result = await pending;
    return version === generation ? result : read();
  }
  return { peek: () => value, read, invalidate };
}
