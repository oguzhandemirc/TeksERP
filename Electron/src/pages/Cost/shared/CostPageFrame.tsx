import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { ListToolbar } from "@/components/layout/ListPage";

/** Girdi Fiyatları sekmesinin başlık (eylem) kabı; araçlar listenin kendi araç çubuğunda kalır. */
export interface CostEmbedSlots {
  actions: HTMLElement | null;
}

/**
 * Maliyet girdi listelerinin (iplik fiyatı, tarife, formül, sarf normu) ortak çerçevesi.
 * Tek başına: başlık + araç satırı. `embedded` verilirse eylemler sekmeli "Girdi Fiyatları"nın
 * başlığına portal'lanır (çift başlık olmaz). `showTools` boş listede araçları gizler.
 */
export function CostPageFrame({
  title,
  description,
  actions,
  tools,
  showTools,
  embedded,
  children,
}: {
  title: string;
  description: string;
  actions: ReactNode;
  tools: ReactNode;
  showTools: boolean;
  embedded?: CostEmbedSlots;
  children: ReactNode;
}) {
  if (embedded) {
    return (
      <PageShell>
        {embedded.actions && createPortal(actions, embedded.actions)}
        {/* Arama/araçlar sekme bandında (zeminde) değil, listenin kart yüzeyinde (B18/13; kartlı liste yüzeyi). */}
        <div className="flex min-h-0 flex-1 flex-col">
          {showTools && <ListToolbar className="flex-row items-center justify-end gap-1.5">{tools}</ListToolbar>}
          {children}
        </div>
      </PageShell>
    );
  }
  return (
    <PageShell>
      <PageHeader title={title} description={description} actions={actions} />
      {showTools && <ListToolbar className="flex-row items-center justify-end gap-1.5">{tools}</ListToolbar>}
      {children}
    </PageShell>
  );
}
