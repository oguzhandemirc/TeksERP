import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { SupportForm } from "./SupportForm";
import { SUPPORT_LIST_KEY, SupportTicketDetail, SupportTicketList } from "./SupportTickets";

/**
 * DESTEK (3d-2) — satıcıya talep açma ve yanıtları izleme. Talep kurulum imzalı gider; satıcıya
 * ulaşılamazsa bekler ve yoklamayla yeniden gönderilir. Yanıtlar zil + yoklamayla gelir.
 * Manifesto `system/support`, izin `support:create` (karo ve route AYNI kod).
 */
export function SupportPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <PageShell>
      <PageHeader title="Destek" />
      <PageBody className="p-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <SupportForm
              onCreated={(t) => {
                setSelected(t.id);
                void qc.invalidateQueries({ queryKey: SUPPORT_LIST_KEY });
              }}
            />
            <SupportTicketList selectedId={selected} onSelect={setSelected} />
          </div>
          <div>{selected ? <SupportTicketDetail id={selected} /> : <p className="text-sm text-muted-foreground">Ayrıntı için bir talep seçin.</p>}</div>
        </div>
      </PageBody>
    </PageShell>
  );
}
