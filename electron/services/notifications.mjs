export function notificationCandidates(snapshot, now = Date.now()) {
  const out = [];
  for (const s of snapshot.servers ?? []) {
    if (s.demo) continue;
    if (s.status === "offline" && s.probeError)
      out.push({
        key: `server:${s.id}`,
        kind: "server",
        id: s.id,
        name: s.name,
        reason: "offline",
      });
  }
  for (const [kind, list] of [
    ["domain", snapshot.domains],
    ["cert", snapshot.certs],
    ["ai", snapshot.aiAssets],
  ]) {
    for (const x of list ?? []) {
      if (x.demo) continue;
      const date = kind === "ai" ? x.renewsAt : x.expiresAt;
      const days = Math.ceil((Date.parse(date) - now) / 86_400_000);
      if (!Number.isFinite(days) || days > 21) continue;
      out.push({
        key: `${kind}:${x.id}:${date}:${days <= 0 ? "expired" : days <= 7 ? "week" : "soon"}`,
        kind,
        id: x.id,
        name: x.name ?? x.cn,
        reason: "expiry",
        days,
      });
    }
  }
  return out;
}

export class NotificationTracker {
  #seen = new Map();
  take(candidates, now = Date.now()) {
    const current = new Set(candidates.map((x) => x.key));
    for (const key of this.#seen.keys()) if (!current.has(key)) this.#seen.delete(key);
    return candidates.filter((x) => {
      const last = this.#seen.get(x.key);
      if (last !== undefined && now - last < 86_400_000) return false;
      this.#seen.set(x.key, now);
      return true;
    });
  }
}
