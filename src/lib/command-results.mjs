/** @param {string} value */
function normalize(value) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

/**
 * 先搜索完整数据，再限制挂载数量；大列表末尾的匹配项也可以找到。
 * @template {{id: string, label: string, search: string, meta?: string}} T
 * @param {{heading: string, entries: T[]}[]} groups
 * @param {string} query
 */
export function commandResults(groups, query) {
  const needle = normalize(query).trim();
  const words = needle.split(/\s+/).filter(Boolean);
  const digits = needle.replace(/[\s()+.-]/g, "");
  const isNumber = /^\d{3,}$/.test(digits);
  let total = 0;
  let shown = 0;
  const sections = [];
  for (const group of groups) {
    const entries = [];
    for (const entry of group.entries) {
      const text = needle ? normalize(`${entry.label} ${entry.search} ${entry.meta ?? ""}`) : "";
      if (
        words.every((word) => text.includes(word)) ||
        (isNumber && text.replace(/[\s()+.-]/g, "").includes(digits))
      ) {
        total++;
        if (shown < 60) {
          entries.push(entry);
          shown++;
        }
      }
    }
    if (entries.length) sections.push({ ...group, entries });
  }
  return { sections, total, shown };
}
