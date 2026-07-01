import { PageHeader } from "../components/PageHeader";
import { ApiTokensSection } from "./connection/ApiTokensSection";
import { ConnectedAppsSection } from "./connection/ConnectedAppsSection";
import { McpSetupCard } from "./connection/McpSetupCard";

export function ConnectionPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Connection" description="Connect apps and agents to your keva storage." />
      <McpSetupCard />
      <ConnectedAppsSection />
      <ApiTokensSection />
    </div>
  );
}
