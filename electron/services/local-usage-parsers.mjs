const numeric = (value) => Number.isSafeInteger(value) && value >= 0;
const identifier = (value) => typeof value === "string" && value.length > 0 && value.length <= 256;

function geminiTokens(value) {
  if (!value || !numeric(value.input) || !numeric(value.output)) return null;
  const cached = value.cached ?? 0;
  const thoughts = value.thoughts ?? 0;
  const tool = value.tool ?? 0;
  if (![cached, thoughts, tool].every(numeric)) return null;
  // Gemini 的 candidates 不含 thoughts，服务端工具输入单列；缓存是输入的子集。
  const total = {
    input: value.input + tool,
    output: value.output + thoughts,
    cached,
    cacheWrite: 0,
  };
  return Object.values(total).every(numeric) && cached <= total.input ? total : null;
}

function grokTokens(value) {
  if (!value || !numeric(value.inputTokens) || !numeric(value.outputTokens)) return null;
  const total = {
    input: value.inputTokens,
    output: value.outputTokens,
    cached: value.cachedReadTokens ?? 0,
    cacheWrite: value.cacheCreationTokens ?? 0,
  };
  // Grok Build 的输入已含缓存、输出已含 reasoningTokens，不再重复相加。
  return Object.values(total).every(numeric) && total.cached + total.cacheWrite <= total.input
    ? total
    : null;
}

/** 仅返回统计字段，不返回会话内容、项目标识或其他日志字段。 */
export function snapshotUsage(client, document) {
  if (!document || !identifier(document.sessionId)) return { events: [], supported: false };
  const events = [];
  if (client === "gemini") {
    if (!Array.isArray(document.messages)) return { events, supported: false };
    for (const message of document.messages) {
      if (!message || message.type !== "gemini" || !identifier(message.id)) continue;
      const total = geminiTokens(message.tokens);
      if (!total) continue;
      events.push({
        id: message.id,
        session: document.sessionId,
        model: message.model,
        time: message.timestamp,
        total,
      });
    }
    return { events, supported: true };
  }
  if (client === "grok") {
    if (!Array.isArray(document.turns)) return { events, supported: false };
    for (const turn of document.turns) {
      if (!turn || !numeric(turn.turnNumber)) continue;
      const models =
        turn.modelUsage && typeof turn.modelUsage === "object" && !Array.isArray(turn.modelUsage)
          ? Object.entries(turn.modelUsage)
          : [[turn.primaryModelId ?? document.session?.primaryModelId, turn]];
      for (const [model, value] of models) {
        const total = grokTokens(value);
        if (!total) continue;
        events.push({
          id: `turn:${turn.turnNumber}:${model ?? "unknown"}`,
          session: document.sessionId,
          model,
          time: turn.endedAt,
          total,
        });
      }
    }
    return { events, supported: true };
  }
  return { events, supported: false };
}
