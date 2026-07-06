import { PageHeader } from "../components/PageHeader";
import { SharesSection } from "./connection/SharesSection";

export function SharesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Share links"
        description="Secret links that give others filtered access to your files. Create one from the Files page."
      />
      <SharesSection />
    </div>
  );
}
