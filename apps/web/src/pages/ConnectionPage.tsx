import { KeyRound, Plug } from "lucide-react";
import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "../components/PageHeader";
import { ApiTokensSection } from "./connection/ApiTokensSection";
import { ConnectedAppsSection } from "./connection/ConnectedAppsSection";
import { McpSetupCard } from "./connection/McpSetupCard";
import { Button } from "@/components/ui/button";

type ConnectionTab = "mcp" | "api";

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
