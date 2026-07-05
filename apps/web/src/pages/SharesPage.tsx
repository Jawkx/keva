import { PageHeader } from "../components/PageHeader";
import { SharesSection } from "./connection/SharesSection";

// Dedicated screen listing every share link the owner has created. New links
// are minted from the Files page (the "Share" button snapshots the active
// filters); this page reviews and revokes them.
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
