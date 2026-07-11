import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrderSelectionPanel } from "./OrderSelectionPanel";
import { PackingWorkspace, type PackingTarget } from "./PackingWorkspace";

/**
 * Paketleme istasyonu (Çuval Havuzu). İki faz: (1) müşteri seç (sipariş seçerek türet
 * veya doğrudan) → (2) müşteri paketleme workspace'i: çuval aç, top okut, tart+kod, mühürle.
 * Mühürlenen çuvallar çuval depo havuzuna girer; sevkiyat AYRI kurulur (Çuval & Top Arama).
 */
export function SackContentEditPage() {
  const [target, setTarget] = useState<PackingTarget | null>(null);

  if (target) {
    return <PackingWorkspace target={target} onExit={() => setTarget(null)} />;
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Paketleme (Çuval Havuzu)"
        description="Müşteri seç → çuval aç, top okut, tart & kod gir, mühürle. Mühürlenen çuvallar depo havuzuna girer; sevkiyatı Çuval & Top Arama'dan kurarsın."
      />
      <div className="min-h-0 flex-1">
        <OrderSelectionPanel onStarted={setTarget} />
      </div>
    </div>
  );
}
