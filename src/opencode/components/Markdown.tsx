import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

const style: Record<string, React.CSSProperties> = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...((oneDark['pre[class*="language-"]'] as React.CSSProperties) ?? {}),
    background: "transparent",
    margin: 0,
    padding: 0,
  },
  'code[class*="language-"]': {
    ...((oneDark['code[class*="language-"]'] as React.CSSProperties) ?? {}),
    background: "transparent",
    fontFamily: 'ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: "12.5px",
  },
};

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 z-10 cursor-pointer rounded border border-border bg-card px-2 py-0.5 font-mono text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
      >
        {copied ? "copied" : "copy"}
      </button>
      {language && (
        <div className="absolute left-3 top-1.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/70">
          {language}
        </div>
      )}
      <SyntaxHighlighter language={language || "text"} style={style as never} PreTag="div" customStyle={{}}>
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

/** Markdown renderer with GFM + syntax highlighting + copy buttons. */
export function Markdown({ content }: { content: string }) {
  const components = useMemo(
    () => ({
      code({
        inline,
        className,
        children,
        ...rest
      }: {
        inline?: boolean;
        className?: string;
        children?: React.ReactNode;
      }) {
        const match = /language-(\w+)/.exec(className || "");
        const text = String(children ?? "");
        if (inline || (!match && !text.includes("\n"))) {
          return (
            <code className={className} {...rest}>
              {children}
            </code>
          );
        }
        return <CodeBlock language={match?.[1] ?? ""}>{text}</CodeBlock>;
      },
      a({ href, children }: { href?: string; children?: React.ReactNode }) {
        return (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      },
    }),
    []
  );

  return (
    <div className="oc-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
