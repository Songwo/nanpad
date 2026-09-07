import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { desktop } from "@/lib/desktop";
import { toast } from "sonner";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
        components={{
          img: ({ alt }) => <span className="text-muted">[{alt || "图片"}]</span>,
          a: ({ href, children: label }) =>
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  const bridge = desktop();
                  if (bridge) {
                    event.preventDefault();
                    void bridge
                      .openExternal(href)
                      .catch((error: Error) => toast.error(error.message));
                  }
                }}
              >
                {label}
              </a>
            ) : (
              <span>{label}</span>
            ),
          table: ({ children: rows }) => (
            <div className="markdown-table">
              <table>{rows}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
