import { useState } from "react";
import Markdown from "react-markdown";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { PreviewModeToggle, type PreviewMode } from "./PreviewModeToggle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface MarkdownPreviewViewerProps {
  source: string;
  className?: string;
}

export function MarkdownPreviewViewer({ source, className }: MarkdownPreviewViewerProps) {
  const [mode, setMode] = useState<PreviewMode>("rendered");

  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-background",
        className,
      )}
    >
      <PreviewModeToggle format="Markdown" mode={mode} onModeChange={setMode} />

      <ScrollArea className="min-h-0 w-full min-w-0 flex-1">
        {mode === "source" ? (
          <pre className="w-max min-w-full px-4 pt-14 pb-4 font-mono text-xs leading-relaxed">
            {source}
          </pre>
        ) : (
          <article className="mx-auto w-full max-w-3xl px-5 pt-14 pb-6 text-sm leading-7 break-words sm:px-8 sm:pt-16 sm:pb-8 [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:mt-0 [&_h1]:mb-6 [&_h1]:font-heading [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:font-heading [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:font-semibold [&_hr]:my-8 [&_li]:my-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_pre]:my-5 [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted/50 [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-6 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
            <Markdown remarkPlugins={[remarkFrontmatter, remarkGfm]}>{source}</Markdown>
          </article>
        )}
      </ScrollArea>
    </div>
  );
}
