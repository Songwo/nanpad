export const OPEN_MARKDOWN_IMPORT = "zhiyu:open-markdown-import";
export const MARKDOWN_IMPORTED = "zhiyu:markdown-imported";

export function requestMarkdownImport() {
  window.dispatchEvent(new Event(OPEN_MARKDOWN_IMPORT));
}
