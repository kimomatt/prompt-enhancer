import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './MarkdownMessage.css';

/**
 * Component for rendering markdown content with proper typography in a ChatGPT-style message card
 * @param {Object} props
 * @param {string} props.text - The markdown text to render
 */
function MarkdownMessage({ text }) {
  return (
    <div className="w-full flex justify-center">
      <div className="max-w-3xl w-full rounded-lg bg-zinc-900/70 border border-zinc-800/70 px-4 py-3">
        <div className="markdown-message prose prose-invert prose-sm max-w-none leading-relaxed dark:prose-invert">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              code(props) {
                const { children, inline, className, ...rest } = props;
                if (inline) {
                  return (
                    <code
                      className="rounded bg-zinc-800/80 px-1 py-0.5 text-xs font-mono"
                      {...rest}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <pre className="my-3 rounded-lg bg-zinc-900/90 p-3 overflow-x-auto">
                    <code className={`text-xs font-mono ${className || ""}`} {...rest}>
                      {children}
                    </code>
                  </pre>
                );
              },
              // Customize headings for better spacing - smaller sizes, no left margin, extra spacing above
              h1: ({ node, ...props }) => (
                <h1 className="mt-10 mb-3 text-xl font-bold text-zinc-100 first:mt-0" {...props} />
              ),
              h2: ({ node, ...props }) => (
                <h2 className="mt-8 mb-2 text-lg font-bold text-zinc-100 first:mt-0" {...props} />
              ),
              h3: ({ node, ...props }) => (
                <h3 className="mt-6 mb-2 text-base font-semibold text-zinc-100 first:mt-0" {...props} />
              ),
              h4: ({ node, ...props }) => (
                <h4 className="mt-5 mb-1 text-sm font-semibold text-zinc-100 first:mt-0" {...props} />
              ),
              // Ensure paragraphs have good spacing - smaller text, no left margin
              p: ({ node, ...props }) => (
                <p className="my-2 text-sm text-zinc-200 leading-relaxed first:mt-0 ml-0" {...props} />
              ),
              // Style lists with proper indentation - indented significantly further right than headers
              ul: ({ node, ...props }) => (
                <ul className="my-2 list-disc list-outside space-y-1 text-sm text-zinc-200 marker:text-zinc-400" {...props} />
              ),
              ol: ({ node, ...props }) => (
                <ol className="my-2 list-decimal list-outside space-y-1 text-sm text-zinc-200 marker:text-zinc-400" {...props} />
              ),
              li: ({ node, ...props }) => (
                <li className="leading-relaxed text-zinc-200" {...props} />
              ),
              // Style blockquotes with better spacing
              blockquote: ({ node, ...props }) => (
                <blockquote 
                  className="border-l-4 border-zinc-600 pl-4 pr-2 py-2 italic my-3 text-sm text-zinc-300 bg-zinc-800/30 rounded-r" 
                  {...props} 
                />
              ),
              // Style links
              a: ({ node, ...props }) => (
                <a 
                  className="text-teal-400 hover:text-teal-300 underline decoration-teal-400/50 hover:decoration-teal-300 transition-colors text-sm" 
                  {...props} 
                />
              ),
              // Style strong/bold
              strong: ({ node, ...props }) => (
                <strong className="font-semibold text-zinc-100" {...props} />
              ),
              // Style emphasis/italic
              em: ({ node, ...props }) => (
                <em className="italic text-zinc-200" {...props} />
              ),
              // Style horizontal rules
              hr: ({ node, ...props }) => (
                <hr className="my-4 border-zinc-700" {...props} />
              ),
              // Style tables
              table: ({ node, ...props }) => (
                <div className="overflow-x-auto my-3">
                  <table className="min-w-full border-collapse border border-zinc-700 rounded-lg text-sm" {...props} />
                </div>
              ),
              thead: ({ node, ...props }) => (
                <thead className="bg-zinc-800/50" {...props} />
              ),
              tbody: ({ node, ...props }) => (
                <tbody className="divide-y divide-zinc-700" {...props} />
              ),
              tr: ({ node, ...props }) => (
                <tr className="hover:bg-zinc-800/30 transition-colors" {...props} />
              ),
              th: ({ node, ...props }) => (
                <th className="px-3 py-2 text-left font-semibold text-xs text-zinc-100 border border-zinc-700" {...props} />
              ),
              td: ({ node, ...props }) => (
                <td className="px-3 py-2 text-xs text-zinc-200 border border-zinc-700" {...props} />
              ),
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default MarkdownMessage;

