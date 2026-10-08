export const MONITOR_MINUTES = [0, 1, 5, 15, 30, 60];
/** @param {unknown} value */
export function validateMonitorMinutes(value) {
  if (typeof value !== "number" || !MONITOR_MINUTES.includes(value))
    throw new Error("请选择支持的服务器采集周期。");
  return value;
}
/** @param {unknown} value */
export function readMonitorMinutes(value) {
  return typeof value === "number" && MONITOR_MINUTES.includes(value) ? value : 5;
}

/** 前次结束后才安排下一轮，隐藏页面和手动模式不发起自动连接。
 * @param {{minutes: number, refresh: () => Promise<unknown>, visible?: () => boolean, onError?: (error: unknown) => void, schedule?: (fn: () => void, ms: number) => any, unschedule?: (timer: any) => void}} options
 */
export function startServerMonitor({
  minutes,
  refresh,
  visible = () => true,
  onError = () => {},
  schedule = setTimeout,
  unschedule = clearTimeout,
}) {
  const interval = validateMonitorMinutes(minutes) * 60000;
  if (!interval) return () => {};
  let cancelled = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const tick = async () => {
    try {
      if (!cancelled && visible()) await refresh();
    } catch (error) {
      if (!cancelled) onError(error);
    } finally {
      if (!cancelled) timer = schedule(() => void tick(), interval);
    }
  };
  void tick();
  return () => {
    cancelled = true;
    unschedule(timer);
  };
}
