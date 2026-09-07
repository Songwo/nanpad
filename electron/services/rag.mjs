import MiniSearch from "minisearch";
import { createHash } from "node:crypto";

const COLLECTIONS = {
  server: "servers",
  domain: "domains",
  cert: "certs",
  mail: "mailboxes",
  ai: "aiAssets",
  secret: "secrets",
};
const FIELDS = [
  "name",
  "label",
  "host",
  "region",
  "os",
  "status",
  "cpu",
  "memory",
  "disk",
  "lastSeen",
  "probedAt",
  "expiresAt",
  "renewsAt",
  "registrar",
  "dns",
  "autoRenew",
  "cn",
  "issuer",
  "address",
  "domain",
  "kind",
  "usedMb",
  "quotaMb",
  "provider",
  "plan",
  "monthlyUsd",
  "usagePct",
  "lastRotated",
  "demo",
  "tags",
];
const LABELS = {
  server: "服务器 主机",
  domain: "域名 续费",
  cert: "证书 到期",
  mail: "邮箱 容量",
  ai: "AI 订阅 费用 用量",
  secret: "凭据 密钥 元信息",
};
export const hash = (text) => createHash("sha256").update(text).digest("hex");

export function tokenize(text) {
  const result =
    String(text)
      .toLowerCase()
      .match(/[a-z0-9]+|\p{Script=Han}/gu) ?? [];
  for (const part of String(text).match(/\p{Script=Han}+/gu) ?? []) {
    for (let i = 0; i < part.length - 1; i++) result.push(part.slice(i, i + 2));
  }
  return result;
}

export function assetDocuments(snapshot) {
  const docs = [];
  for (const [kind, collection] of Object.entries(COLLECTIONS)) {
    for (const asset of snapshot[collection] ?? []) {
      if (typeof asset?.id !== "string" || !asset.id || asset.id.length > 200) continue;
      // 仅索引白名单元信息；密钥值、账号密码及自由备注不进入模型上下文。
      const fields = Object.fromEntries(
        FIELDS.filter(
          (key) =>
            ["string", "number", "boolean"].includes(typeof asset[key]) ||
            (key === "tags" && Array.isArray(asset[key])),
        ).map((key) => [
          key,
          typeof asset[key] === "string"
            ? asset[key].slice(0, 500)
            : key === "tags"
              ? asset[key]
                  .filter((tag) => typeof tag === "string")
                  .slice(0, 30)
                  .map((tag) => tag.slice(0, 100))
              : asset[key],
        ]),
      );
      const id = `asset:${kind}:${asset.id}`;
      const title = String(asset.name ?? asset.cn ?? asset.address ?? asset.id);
      docs.push({
        id,
        title,
        kind,
        assetId: asset.id,
        text: `${LABELS[kind]}\n\n${Object.entries(fields)
          .map(
            ([key, value]) =>
              `- ${key}: ${String(value)
                .replace(/[\\`*_{}[\]<>|]/g, "\\$&")
                .replace(/\r?\n/g, " ")}`,
          )
          .join("\n")}`,
        fields,
      });
    }
  }
  const ids = new Set(docs.map((doc) => doc.id));
  for (const doc of docs) {
    const links = (snapshot.links ?? []).flatMap(({ from, to }) => {
      const a = `asset:${from.kind}:${from.id}`,
        b = `asset:${to.kind}:${to.id}`;
      return doc.id === a && ids.has(b) ? [b] : doc.id === b && ids.has(a) ? [a] : [];
    });
    if (links.length) doc.text += `\n关联: ${links.join(", ")}`;
  }
  return docs;
}

export function knowledgeChunks(documents) {
  return documents.flatMap((doc) => {
    const chunks = [];
    for (let start = 0; start < doc.text.length; start += 800) {
      chunks.push({
        id: `doc:${doc.id}:${start}`,
        documentId: doc.id,
        title: doc.name,
        text: doc.text.slice(start, start + 1000),
        chunk: Math.floor(start / 800) + 1,
      });
    }
    return chunks;
  });
}

export class LocalIndex {
  constructor(snapshot, documents) {
    this.docs = [...assetDocuments(snapshot), ...knowledgeChunks(documents)];
    if (this.docs.length > 6000) throw new Error("本地索引超过 6000 个片段，请减少导入文档。");
    this.byId = new Map(this.docs.map((doc) => [doc.id, doc]));
    this.searcher = new MiniSearch({ fields: ["title", "text"], storeFields: [], tokenize });
    this.searcher.addAll(this.docs);
  }
  search(query, limit = 6) {
    return this.searcher
      .search(query, { boost: { title: 3 }, prefix: true, combineWith: "OR" })
      .slice(0, limit)
      .map((row) => ({ ...this.byId.get(row.id), score: row.score }));
  }
  summary() {
    const assets = this.docs.filter((x) => x.assetId);
    const counts = Object.fromEntries(
      Object.keys(COLLECTIONS).map((kind) => [kind, assets.filter((x) => x.kind === kind).length]),
    );
    return {
      counts,
      total: assets.length,
      demo: assets.filter((x) => x.fields.demo).length,
      monthlyUsd: assets.reduce((sum, x) => sum + (Number(x.fields.monthlyUsd) || 0), 0),
      attention: assets
        .filter((x) => x.fields.status !== "online")
        .map((x) => ({ sourceId: x.id, title: x.title, status: x.fields.status })),
    };
  }
}

export function cosine(a, b) {
  if (a.length !== b.length || !a.length) throw new Error("Embedding 向量维度不一致。");
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function hybridSearch(index, query, vector, vectors, limit) {
  const scores = new Map();
  const lexical = index.search(query, 30);
  const semantic = index.docs
    .map((doc) => ({ id: doc.id, score: cosine(vector, vectors[hash(doc.text)]) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  for (const list of [lexical, semantic])
    list.forEach((doc, i) => scores.set(doc.id, (scores.get(doc.id) ?? 0) + 1 / (60 + i)));
  return [...scores]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ ...index.byId.get(id), score }));
}
