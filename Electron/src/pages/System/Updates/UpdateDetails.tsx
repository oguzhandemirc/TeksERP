import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { UpdateStatus } from "@/types/server-update";
import { LastResultCard, PolicyCard, UpdaterCard, VersionCard } from "../ServerUpdates/UpdateCards";
import { showsApprovalDetails, UpdateApprovalCard } from "../ServerUpdates/UpdateApprovalCard";
import { UpdateHistoryCard } from "../ServerUpdates/UpdateHistoryCard";
import { PanelUpdateDetails } from "./PanelUpdateDetails";

/**
 * Teknik ayrıntılar — varsayılan KAPALI, kaybolmaz (destek için durur). Sunucu kartları yalnız tam durumu
 * okuyabilene (`license:view ∨ license:manage`); içerik açılınca çizilir.
 */
export function UpdateDetails({ full, canManage }: { full: UpdateStatus | undefined; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <section>
      <button type="button" aria-expanded={open} className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>
        <Icon className="h-4 w-4" />
        Ayrıntılar
      </button>
      {open && (
        <div data-testid="guncelleme-ayrintilari" className="mt-3 grid gap-4 xl:grid-cols-2">
          {full && (
            <>
              <VersionCard s={full} />
              <PolicyCard s={full} />
              <UpdaterCard s={full} />
              {canManage && showsApprovalDetails(full) && <UpdateApprovalCard s={full} />}
              <LastResultCard s={full} />
            </>
          )}
          <PanelUpdateDetails />
          {full && <UpdateHistoryCard items={full.gecmis} />}
        </div>
      )}
    </section>
  );
}
