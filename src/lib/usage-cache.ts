import { desktop } from "./desktop";
import { createCachedResource } from "./cached-resource.mjs";

/** 仅缓存统计数字与来源状态，离开页面不丢弃，不触发远程采集。 */
export const usageCache = createCachedResource(
  async () => {
    const api = desktop()?.usage;
    if (!api) throw new Error("用量统计仅桌面端可用。");
    const [data, status] = await Promise.all([api.list(), api.localStatus()]);
    return { data, status };
  },
  { maxAge: 10000 },
);
