import { CodeXml } from "lucide-react";
import { Link } from "react-router-dom";
import type { QueryCondition } from "@keva/schema";
import { CodeBlock } from "./CodeBlock";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const PUBLIC_API_URL = "https://api.usekeva.com/v1";

const buildSnippets = (baseUrl: string, search: string, where: readonly QueryCondition[]) => {
  const trimmed = search.trim();
  const query = { where, ...(trimmed ? { search: trimmed } : {}), limit: 100 };
  const curl = `curl -X POST ${baseUrl}/query \\
  -H "Authorization: Bearer $KEVA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(query)}'`;
  const sdk = `import { KevaClient } from "@keva/sdk";

const keva = new KevaClient({
  baseUrl: "${baseUrl}",
  token: process.env.KEVA_TOKEN,
});

const { items } = await keva.query(${JSON.stringify(query, null, 2)});`;
  return { curl, sdk };
};

export function ApiSnippetsPopover({ search, where }: { search: string; where: QueryCondition[] }) {
  const snippets = buildSnippets(PUBLIC_API_URL, search, where);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="API query for this filter"
            title="API query for this filter"
          />
        }
      >
        <CodeXml />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[34rem] max-w-[calc(100vw-2rem)] gap-4 p-4">
        <CodeBlock label="curl" code={snippets.curl} />
        <CodeBlock label="TypeScript SDK" code={snippets.sdk} />
        <p className="text-sm text-muted-foreground">
          Generate a token on the{" "}
          <Link to="/connection" className="text-primary hover:underline">
            Connection
          </Link>{" "}
          page and export it as <code className="font-mono">KEVA_TOKEN</code>.
        </p>
      </PopoverContent>
    </Popover>
  );
}
