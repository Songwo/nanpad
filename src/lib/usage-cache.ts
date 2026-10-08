import { desktop } from "./desktop";
import { createUsageResource } from "./usage-resource.mjs";

/** 仅缓存统计数字与来源状态，离开页面不丢弃，不触发远程采集。 */
export const usageCache = createUsageResource(() => desktop()?.usage, { maxAge: 10000 });
