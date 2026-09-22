/** 同一资产共享正在执行的探测，避免定时任务与手动刷新重复连接。 */
export class ProbeFlights {
  private pending = new Map<string, Promise<void>>();
  run(key: string, task: () => Promise<void>): Promise<void> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(task)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}

/** 只向仍存在且连接目标未变的最新资产写回；保留探测期间的编辑。 */
export function currentProbeAsset<T extends { id: string }>(
  items: T[],
  requested: T,
  connectionFields: (keyof T)[],
): T | undefined {
  const current = items.find((item) => item.id === requested.id);
  return current && connectionFields.every((key) => current[key] === requested[key])
    ? current
    : undefined;
}
