import { AiAccounts, AI_PROVIDERS } from "../electron/services/ai-accounts.mjs";
import { Vault } from "../electron/services/vault.mjs";

if (!process.env.NANPAD_TEST_DATA_DIR) throw new Error("AI 集成测试必须使用隔离数据目录。");
globalThis.__qaModules = { AiAccounts, AI_PROVIDERS, Vault };
await import("../electron/main.mjs");
