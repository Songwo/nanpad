import test from "node:test";
import assert from "node:assert/strict";
import { assetDocuments } from "./rag.mjs";

test("未提供的订阅费用和用量不以零值进入 RAG 上下文", () => {
  const [doc] = assetDocuments({
    aiAssets: [
      {
        id: "linked-ai",
        name: "Grok",
        monthlyUsd: 0,
        monthlyUsdKnown: false,
        usagePct: 0,
        usageAvailable: false,
        subscriptionExpiresAt: null,
      },
    ],
  });
  assert.doesNotMatch(doc.text, /- monthlyUsd:/);
  assert.doesNotMatch(doc.text, /- usagePct:/);
  assert.match(doc.text, /monthlyUsdKnown: false/);
  assert.match(doc.text, /usageAvailable: false/);
});
