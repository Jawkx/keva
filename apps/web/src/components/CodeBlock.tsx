import { CopyButton } from "./CopyButton";

interface CodeBlockProps {
  code: string;
  label?: string;
}

export function CodeBlock({ code, label }: CodeBlockProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      )}
      <div className="relative">
        <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
        <div className="absolute top-1.5 right-1.5">
          <CopyButton value={code} label="Copy code" />
        </div>
      </div>
    </div>
  );
}
