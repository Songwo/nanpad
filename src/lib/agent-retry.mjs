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
