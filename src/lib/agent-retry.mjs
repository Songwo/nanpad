/**
 * 重试仅取失败问题之前的上下文，不携带失败回答，也不自动恢复一次性权限。
 * @param {import("./conversations").Message[]} messages
 * @param {string} messageId
 */
export function retryRequest(messages, messageId) {
  const index = messages.findIndex((message) => message.id === messageId);
  if (
    index < 0 ||
    !messages[index].blocks.some((block) => block.type === "run" && block.status !== "success")
  )
    return null;
  return continuationRequest(messages, messageId);
}

/**
 * 重新处理原问题，保留此前上下文；不把被替代的回答送回模型，也不自行恢复权限。
 * @param {import("./conversations").Message[]} messages
 * @param {string} messageId
 */
export function continuationRequest(messages, messageId) {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0 || messages[index].role !== "agent") return null;
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role !== "you") continue;
    const question = messages[i].blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    return {
      question,
      history: messages.slice(0, i),
      appendQuestion: index !== messages.length - 1,
    };
  }
  return null;
}

/**
 * 授权按钮列出继续原任务需要的完整范围，防止两类权限来回请求。
 * 旧版本回答没有结构化请求时，提供两个独立入口，由用户主动选择范围。
 * @param {import("./conversations").Message} message
 * @returns {import("./agent-client").WorkspaceAccessRequest[]}
 */
export function workspaceAccessOptions(message) {
  const run = message.blocks.find((block) => block.type === "run");
  if (message.role !== "agent" || !run || run.status !== "success") return [];
  const requests = message.blocks.flatMap((block) =>
    block.type === "access" ? [block.request] : [],
  );
  const options = requests.length
    ? requests
    : run.workspaceChanges === undefined &&
        !message.blocks.some((block) => block.type === "proposal") &&
        message.blocks.some(
          (block) => block.type === "sources" && block.sources.some((source) => source.documentId),
        )
      ? [
          ...(!run.documentContent ? [{ permissions: ["documentContent"], reason: "" }] : []),
          { permissions: ["workspaceChanges"], reason: "" },
        ]
      : [];
  return options
    .map((request) => ({
      reason: request.reason,
      permissions: /** @type {Array<"documentContent" | "workspaceChanges">} */ ([
        ...new Set([
          ...request.permissions.filter((permission) =>
            ["documentContent", "workspaceChanges"].includes(permission),
          ),
          ...(run.documentContent ? ["documentContent"] : []),
          ...(run.workspaceChanges ? ["workspaceChanges"] : []),
        ]),
      ]),
    }))
    .filter((request) => request.permissions.length > 0);
}

/**
 * @param {import("./conversations").Message[]} messages
 * @returns {Array<{role: "user" | "assistant", documentContent: boolean, content: string}>}
 */
export function modelHistory(messages) {
  return messages
    .filter(
      (message) =>
        !message.blocks.some(
          (block) =>
            block.type === "secret" || (block.type === "run" && block.status !== "success"),
        ),
    )
    .map((message) => ({
      role: message.role === "you" ? "user" : "assistant",
      documentContent: message.blocks.some(
        (block) => block.type === "run" && block.documentContent === true,
      ),
      content: message.blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
    }));
}
