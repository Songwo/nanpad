import { accountId, desktop } from "./desktop";
import { useAppStore } from "./store";

/**
 * Move plaintext secret bodies out of `assets.json` and into the vault.
 *
 * Early builds stored `Secret.value` alongside the rest of the record, which
 * meant an export — or anyone reading the data file — got the API key too. This
 * runs once the vault is unlocked, copies anything still sitting in the clear,
 * and blanks the field. Idempotent: a secret whose vault entry already exists
 * is only cleared, never overwritten.
 */
export async function migrateSecretValues(): Promise<number> {
  const bridge = desktop();
  if (!bridge) return 0;

  const legacy = useAppStore.getState().secrets.filter((s) => Boolean(s.value));
  if (legacy.length === 0) return 0;

  let moved = 0;
  for (const secret of legacy) {
    const key = accountId(secret.id);
    try {
      const existing = await bridge.vault.get(key);
      if (!existing) {
        await bridge.vault.set(key, {
          password: secret.value,
          updatedAt: new Date().toISOString(),
        });
        moved += 1;
      }
      useAppStore.getState().upsertSecret({ ...secret, value: "" });
    } catch {
      // A failure here must not blank the only copy of the value.
      return moved;
    }
  }

  if (moved > 0) {
    useAppStore.getState().log(`已把 ${moved} 条密钥内容移入加密库`, "secret");
  }
  return moved;
}
