import { KeyRound, Plug } from "lucide-react";
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { ApiTokensSection } from "./connection/ApiTokensSection";
import { ConnectedAppsSection } from "./connection/ConnectedAppsSection";
import { McpSetupCard } from "./connection/McpSetupCard";
import { Button } from "@/components/ui/button";

type ConnectionTab = "mcp" | "api";

const TAB_DESCRIPTIONS: Record<ConnectionTab, string> = {
  mcp: "Connect AI agents to your keva storage over the Model Context Protocol.",
  api: "Bearer tokens for scripts, the SDK, and direct API access.",
};

export function ConnectionPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tab: ConnectionTab = searchParams.get("tab") === "api" ? "api" : "mcp";

  const setTab = useCallback(
    (next: ConnectionTab) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.set("tab", next);
          return sp;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Connection" />

      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={tab === "mcp" ? "default" : "outline"}
            onClick={() => setTab("mcp")}
          >
            <Plug data-icon="inline-start" />
            MCP
          </Button>
          <Button
            size="sm"
            variant={tab === "api" ? "default" : "outline"}
            onClick={() => setTab("api")}
          >
            <KeyRound data-icon="inline-start" />
            API tokens
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{TAB_DESCRIPTIONS[tab]}</p>
      </div>

      {tab === "mcp" ? (
        <>
          <McpSetupCard />
          <ConnectedAppsSection />
        </>
      ) : (
        <ApiTokensSection />
      )}
    </div>
  );
}
