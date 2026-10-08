import { createHash, randomUUID } from "node:crypto";
import { documentRevision } from "./documents.mjs";

const COLLECTIONS = {
  server: "servers",
  domain: "domains",
  mail: "mailboxes",
  ai: "aiAssets",
  secret: "secrets",
  cert: "certs",
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = (ref) => `${ref.kind}:${ref.id}`;
const pairKey = (link) => [key(link.from), key(link.to)].sort().join("|");
const ownKeys = (value, allowed) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => allowed.includes(key));
function text(value, max, label) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${label}无效。`);
  return value;
}
function resource(snapshot, ref) {
  if (
    !ownKeys(ref, ["kind", "id"]) ||
    !Object.hasOwn(COLLECTIONS, ref.kind) ||
    typeof ref.id !== "string"
  )
    throw new Error("资产引用无效。");
  const asset = (snapshot[COLLECTIONS[ref.kind]] ?? []).find((asset) => asset.id === ref.id);
  if (!asset) throw new Error("资产已不存在，请重新生成建议。");
  return asset;
}
const label = (asset) => asset.name || asset.address || asset.cn || asset.id;
const accountPreview = (value) =>
  Object.entries(value)
    .map(
      ([field, content]) =>
        `${field === "name" ? "名称" : "标签"}：${Array.isArray(content) ? content.join("、") : content}`,
    )
    .join("\n");

/** 模型只能暂存建议；应用入口只接受主进程签发的随机标识。 */
export class WorkspaceActions {
  constructor({ getSnapshot, documents, mutateAssets, now = Date.now }) {
    this.getSnapshot = getSnapshot;
    this.documents = documents;
    this.mutateAssets = mutateAssets;
    this.now = now;
    this.pending = new Map();
    // 已处理记录只留短期标识与状态，不占待审阅容量，也不保留整篇文档。
    this.finished = new Map();
  }
  prune() {
    const now = this.now();
    for (const [id, proposal] of this.pending)
      if (proposal.state === "pending" && proposal.expiresAt <= now) this.pending.delete(id);
    for (const [id, record] of this.finished) if (record.expiresAt <= now) this.finished.delete(id);
  }
  finish(proposal, state) {
    this.pending.delete(proposal.id);
    this.finished.set(proposal.id, { state, expiresAt: this.now() + 30 * 60 * 1000 });
    while (this.finished.size > 1024) this.finished.delete(this.finished.keys().next().value);
  }
  async propose(name, args, { allowDocumentContent = false, requestId } = {}) {
    if (
      !ownKeys(args, ["documentId", "find", "replace", "assetId", "patch", "from", "to", "reason"])
    )
      throw new Error("不允许的修改字段。");
    const reason = text(args.reason, 1200, "修改依据");
    const snapshot = this.getSnapshot();
    let details;
    if (name === "propose_document_edit") {
      if (!ownKeys(args, ["documentId", "find", "replace", "reason"]))
        throw new Error("不允许的文档修改字段。");
      if (!allowDocumentContent)
        throw new Error("请先勾选本次允许检索文档正文，再生成文档修改建议。");
      text(args.find, 4000, "原文");
      if (
        typeof args.replace !== "string" ||
        args.replace.length > 6000 ||
        args.replace === args.find
      )
        throw new Error("替换文本无效或未变化。");
      const doc = await this.documents.get(args.documentId);
      const next = structuredClone(doc);
      let matches = 0;
      const visit = (node) => {
        if (node.type === "text" && typeof node.text === "string") {
          matches += node.text.split(args.find).length - 1;
          node.text = node.text.replace(args.find, () => args.replace);
        }
        node.content?.forEach(visit);
      };
      visit(next.content);
      if (matches !== 1)
        throw new Error("原文必须在同一文本段落中唯一匹配，请缩小修改片段后重试。");
      details = {
        type: "document-edit",
        title: doc.title,
        documentId: doc.id,
        before: args.find,
        after: args.replace,
        revision: documentRevision(doc),
        next,
      };
    } else if (name === "propose_account_edit") {
      if (
        !ownKeys(args, ["assetId", "patch", "reason"]) ||
        !ownKeys(args.patch, ["name", "tags"]) ||
        !Object.keys(args.patch).length
      )
        throw new Error("账号只允许修改名称和标签；密码、用户名、网址请在本机账号面板编辑。");
      const ref = { kind: "secret", id: args.assetId };
      const asset = resource(snapshot, ref);
      const patch = {};
      if (args.patch.name !== undefined) patch.name = text(args.patch.name, 200, "账号名称").trim();
      if (args.patch.tags !== undefined) {
        if (
          !Array.isArray(args.patch.tags) ||
          args.patch.tags.length > 20 ||
          args.patch.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 80)
        )
          throw new Error("标签格式无效。");
        patch.tags = [...new Set(args.patch.tags.map((tag) => tag.trim()))];
      }
      const before = Object.fromEntries(
        Object.keys(patch).map((field) => [field, asset[field] ?? (field === "tags" ? [] : "")]),
      );
      details = {
        type: "account-edit",
        title: label(asset),
        assetId: asset.id,
        before: accountPreview(before),
        after: accountPreview(patch),
        revision: hash(asset),
        patch,
      };
    } else if (name === "propose_asset_link") {
      if (!ownKeys(args, ["from", "to", "reason"])) throw new Error("不允许的关联字段。");
      const from = resource(snapshot, args.from),
        to = resource(snapshot, args.to);
      const link = { from: args.from, to: args.to };
      if (key(args.from) === key(args.to)) throw new Error("不能关联同一资产。");
      if ((snapshot.links ?? []).some((item) => pairKey(item) === pairKey(link)))
        throw new Error("这两个资产已经关联。");
      details = {
        type: "asset-link",
        title: `${label(from)} ↔ ${label(to)}`,
        before: "未关联",
        after: "建立关联",
        link,
        revision: hash([from, to]),
      };
    } else if (name === "propose_document_binding") {
      if (!ownKeys(args, ["documentId", "to", "reason"])) throw new Error("不允许的文档关联字段。");
      const asset = resource(snapshot, args.to),
        doc = await this.documents.get(args.documentId);
      if (doc.bindings.some((ref) => key(ref) === key(args.to)))
        throw new Error("文档已经关联此资产。");
      details = {
        type: "document-binding",
        title: `${doc.title} ↔ ${label(asset)}`,
        documentId: doc.id,
        before: "未关联",
        after: "建立关联",
        to: args.to,
        revision: documentRevision(doc),
        assetRevision: hash(asset),
        next: { ...doc, bindings: [...doc.bindings, args.to] },
      };
    } else throw new Error("未知的修改建议。");
    this.prune();
    if (this.pending.size >= 80) throw new Error("待审阅建议过多，请先应用或放弃已有建议。");
    const proposal = {
      ...details,
      id: randomUUID(),
      reason,
      requestId,
      expiresAt: this.now() + 30 * 60 * 1000,
      state: "pending",
    };
    this.pending.set(proposal.id, proposal);
    return this.public(proposal);
  }
  public({ id, type, title, documentId, assetId, before, after, reason, expiresAt }) {
    return { id, type, title, documentId, assetId, before, after, reason, expiresAt };
  }
  discardRequest(requestId) {
    for (const [id, proposal] of this.pending)
      if (proposal.requestId === requestId && proposal.state === "pending") this.pending.delete(id);
  }
  discard(id) {
    this.prune();
    if (this.finished.get(id)?.state === "applied") throw new Error("此建议已经应用，不能再忽略。");
    const proposal = this.pending.get(id);
    if (proposal?.state === "applying") throw new Error("此建议正在应用，请等待修改保存。");
    if (proposal) this.finish(proposal, "dismissed");
    // 历史对话中的过期建议也允许隐藏，不会重新创建任何修改。
    return true;
  }
  async apply(id) {
    this.prune();
    const finished = this.finished.get(id);
    if (finished)
      throw new Error(
        finished.state === "applied"
          ? "此建议已经应用，请勿重复操作。"
          : "此建议已忽略，请重新生成后审阅。",
      );
    const proposal = this.pending.get(id);
    if (!proposal || proposal.expiresAt <= this.now())
      throw new Error("建议已过期或软件已重启，请重新生成后审阅。");
    if (proposal.state !== "pending") throw new Error("此建议正在应用或已经应用，请勿重复操作。");
    proposal.state = "applying";
    try {
      let result;
      if (proposal.type === "document-edit" || proposal.type === "document-binding") {
        const assertCurrent = proposal.to
          ? () => {
              if (hash(resource(this.getSnapshot(), proposal.to)) !== proposal.assetRevision)
                throw new Error("关联资产已变化，请重新生成建议。");
            }
          : null;
        assertCurrent?.();
        const document = await this.documents.save(proposal.next, {
          expectedRevision: proposal.revision,
          assertCurrent,
        });
        result = { document };
      } else {
        result = await this.mutateAssets((snapshot) => {
          if (proposal.type === "account-edit") {
            const asset = resource(snapshot, { kind: "secret", id: proposal.assetId });
            if (hash(asset) !== proposal.revision)
              throw new Error("账号资料已变化，请重新生成建议。");
            return {
              ...snapshot,
              secrets: snapshot.secrets.map((item) =>
                item.id === asset.id ? { ...item, ...proposal.patch } : item,
              ),
            };
          }
          const from = resource(snapshot, proposal.link.from),
            to = resource(snapshot, proposal.link.to);
          if (hash([from, to]) !== proposal.revision)
            throw new Error("关联资产已变化，请重新生成建议。");
          const seen = new Set();
          const links = [...(snapshot.links ?? []), proposal.link].filter((link) => {
            try {
              resource(snapshot, link.from);
              resource(snapshot, link.to);
            } catch {
              return false;
            }
            const id = pairKey(link);
            if (key(link.from) === key(link.to) || seen.has(id)) return false;
            seen.add(id);
            return true;
          });
          return { ...snapshot, links };
        });
      }
      this.finish(proposal, "applied");
      return result;
    } catch (error) {
      proposal.state = "pending";
      throw error;
    }
  }
}
