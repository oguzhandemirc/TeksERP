import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { PackagePlus, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { SacksListView } from "./SacksListView";
import { SackEditorView } from "./SackEditorView";
import { SackEntryGate, customerFilterValue, shouldShowEntryGate, type SackGateStep } from "./SackEntryGate";
import { NewSackDialog } from "./NewSackDialog";
import type { EditorTarget, SackSearchRow } from "./types";

/** Arama satırından editör hedefi türet (müşteri/şube bilgisini taşır). */
function rowToTarget(s: SackSearchRow): EditorTarget {
  return {
    sackId: s.id,
    sackNo: s.sackNo,
    customerId: s.customer?.id ?? null,
    customerName: s.customer?.name ?? null,
    branchId: s.branch?.id ?? null,
    branchName: s.branch?.name ?? null,
    branchCode: s.branch?.code ?? null,
  };
}

/**
 * Çuval Deposu / Paketleme hub — TEK ekran, üç mod:
 *  0) Giriş kapısı (2026-09-04): "Tüm Çuvallar" / "Tüm Cariler".
 *  1) Liste: filtrele/ara, çoklu seç → sevkiyat kur.
 *  2) Editör: "Yeni Çuval" veya depodaki bir çuvala tıkla → içerik düzenle.
 * Eski ayrı "Çuval & Top Arama" ekranı bu hub'a taşındı.
 */
export function SackContentEditPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  // Kapı yalnız "çıplak" girişte çizilir — gerekçe `shouldShowEntryGate`te.
  // ⚠️ ADIM BURADA YAŞAR (kapının içinde DEĞİL): "cari listesi" adımından çıkışın
  // TEK yüzeyi PageHeader'ın geri okudur. Adım kapının kendi state'i olsaydı ok
  // onu geri alamaz, kapı da kendi ikinci "Geri" düğmesini çizmek zorunda kalırdı
  // (2026-09-04 saha turu: ekranda iki geri tuşu görünüyordu).
  const [gateStep, setGateStep] = useState<SackGateStep | null>(() =>
    shouldShowEntryGate(location.state, searchParams) ? "choice" : null,
  );
  const gateOpen = gateStep !== null;

  if (target) {
    return (
      <SackEditorView
        target={target}
        onExit={() => setTarget(null)}
        onReassigned={(patch) => setTarget((t) => (t ? { ...t, ...patch } : t))}
        onSwitchSack={(t) => setTarget(t)}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Paketleme / Çuvallar"
        // TEK GERİ YÜZEYİ: cari listesi adımındayken başlıktaki ok bir adım geri
        // alır (kapının seçim karolarına). Diğer durumlarda `undefined` — ok
        // varsayılan davranışına (sekme geçmişi → breadcrumb üstü) düşer.
        onBack={gateStep === "customers" ? () => setGateStep("choice") : undefined}
        actions={
          <>
            {!gateOpen && (
              // Kapıya dönüş — cari değiştirmenin tek tuşluk yolu. Süzgeç
              // TEMİZLENİR, yoksa kapıdan "Tüm Çuvallar" seçen kullanıcı hâlâ
              // eski cariye süzülmüş bir liste görür ve sebebini bulamaz.
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setSearchParams(
                    (prev) => {
                      const next = new URLSearchParams(prev);
                      next.delete("filter[customerId]");
                      return next;
                    },
                    { replace: true },
                  );
                  setGateStep("choice");
                }}
              >
                <Users className="h-4 w-4" /> Cari Seç
              </Button>
            )}
            <Button size="sm" onClick={() => setNewOpen(true)} className="gap-1.5">
              <PackagePlus className="h-4 w-4" /> Yeni Çuval
            </Button>
            <RefreshButton
              queryKey="sack-search"
              extraKeys={[["packing"]]}
              successMessage="Çuval listesi yenilendi"
            />
          </>
        }
      />
      {gateStep ? (
        <SackEntryGate
          step={gateStep}
          onOpenCustomers={() => setGateStep("customers")}
          onPickAll={() => setGateStep(null)}
          onPickCustomer={(bucket) => {
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set("filter[customerId]", customerFilterValue(bucket));
                return next;
              },
              { replace: true },
            );
            setGateStep(null);
          }}
        />
      ) : (
        <SacksListView onEditSack={(s) => setTarget(rowToTarget(s))} />
      )}
      <NewSackDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(t) => setTarget(t)} />
    </PageShell>
  );
}
