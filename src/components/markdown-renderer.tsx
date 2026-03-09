import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="prose prose-stone max-w-none prose-headings:font-semibold prose-headings:text-[var(--color-ink)] prose-p:text-[var(--color-muted)] prose-li:text-[var(--color-muted)] prose-strong:text-[var(--color-ink)] prose-code:rounded prose-code:bg-[var(--color-accent-soft)] prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.95em]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
