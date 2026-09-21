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
import { PackingLotListView } from "./PackingLotListView";
import { isLotMode, singleCustomerFromFilter } from "./packingLotUi";
import { usePackingGroupMode, usePackingGroupsEnabled } from "@/hooks/usePricingEnabled";
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

  const { gateStep, setGateStep, gateOpen, returnStep, setReturnStep, backToGate } = useEntryGate(location.state, searchParams, setSearchParams);
  const { lotMode, singleCustomer, groupFilter, lotList, setGroupFilter } = useLotRouting(gateOpen, searchParams, setSearchParams);
  // Geri oku üç seviyeli: cari listesi → karolar · parti içi → parti listesi · liste → gelinen kapı adımı.
  const onBack =
    gateStep === "customers"
      ? () => setGateStep("choice")
      : !gateOpen && lotMode && singleCustomer && groupFilter
        ? () => setGroupFilter(null)
        : !gateOpen && returnStep
          ? () => backToGate(returnStep)
          : undefined;

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
        onBack={onBack}
        actions={
          <>
            {!gateOpen && (
              // Kapıya dönüş — cari değiştirmenin tek tuşluk yolu.
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => backToGate("choice")}
              >
                <Users className="h-4 w-4" /> Cari Seç
              </Button>
            )}
            <Button size="sm" onClick={() => setNewOpen(true)} className="gap-1.5"><PackagePlus className="h-4 w-4" /> Yeni Çuval</Button>
            <RefreshButton queryKey="sack-search" extraKeys={[["packing"]]} successMessage="Çuval listesi yenilendi" />
          </>
        }
      />
      {gateStep ? (
        <SackEntryGate
          step={gateStep}
          onOpenCustomers={() => setGateStep("customers")}
          onPickAll={() => {
            setReturnStep("choice");
            setGateStep(null);
          }}
          onPickCustomer={(bucket) => {
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set("filter[customerId]", customerFilterValue(bucket));
                return next;
              },
              { replace: true },
            );
            setReturnStep("customers");
            setGateStep(null);
          }}
        />
      ) : lotList ? (
        <PackingLotListView customerId={singleCustomer!} onOpen={(v) => setGroupFilter(v)} />
      ) : (
        <SacksListView onEditSack={(s) => setTarget(rowToTarget(s))} />
      )}
      {/* Cari ön-dolumu yalnız LİSTE ekrandayken — kapıda bayat süzgeç dolmasın. */}
      <NewSackDialog open={newOpen} onOpenChange={setNewOpen} onCreated={setTarget} prefillCustomer={!gateOpen} />
    </PageShell>
  );
}

/**
 * Giriş kapısının adımı ve geri yolu. Kapı yalnız "çıplak" girişte çizilir — gerekçe
 * `shouldShowEntryGate`te. ⚠️ ADIM BURADA YAŞAR (kapının içinde DEĞİL): "cari listesi"
 * adımından çıkışın TEK yüzeyi PageHeader'ın geri okudur (2026-09-04: iki geri tuşu).
 * `returnStep`: kapıdan geçilen adım — listedeyken geri oku o adıma DÖNDÜRÜR (Tüm
 * Çuvallar → karolar, cari → cari listesi), Operasyon hub'ına değil (saha 2026-09-21).
 * Kapısız girişte (sekme/derin bağlantı) null kalır → ok varsayılan davranışında.
 */
function useEntryGate(
  state: unknown,
  searchParams: URLSearchParams,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
) {
  const [gateStep, setGateStep] = useState<SackGateStep | null>(() =>
    shouldShowEntryGate(state, searchParams) ? "choice" : null,
  );
  const [returnStep, setReturnStep] = useState<SackGateStep | null>(null);
  const backToGate = (step: SackGateStep) => {
    // Süzgeç TEMİZLENİR, yoksa kapıdan "Tüm Çuvallar" seçen kullanıcı hâlâ eski
    // cariye süzülmüş bir liste görür ve sebebini bulamaz.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("filter[customerId]");
        return next;
      },
      { replace: true },
    );
    setReturnStep(null);
    setGateStep(step);
  };
  return { gateStep, setGateStep, gateOpen: gateStep !== null, returnStep, setReturnStep, backToGate };
}

/**
 * Sevk partisi modu (2026-09-22): cariye girince PARTİ LİSTESİ; satır tıklanınca
 * `filter[packingGroupId]` yazılır ve çuval listesi o partiye süzülü gelir. Geri oku
 * önce parti listesine, sonra kapıya döner (seviye seviye).
 */
function useLotRouting(gateOpen: boolean, searchParams: URLSearchParams, setSearchParams: ReturnType<typeof useSearchParams>[1]) {
  const lotMode = isLotMode(usePackingGroupsEnabled(), usePackingGroupMode());
  const singleCustomer = singleCustomerFromFilter(searchParams);
  const groupFilter = searchParams.get("filter[packingGroupId]") ?? "";
  const lotList = !gateOpen && lotMode && !!singleCustomer && !groupFilter;
  const setGroupFilter = (value: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set("filter[packingGroupId]", value);
        else next.delete("filter[packingGroupId]");
        next.delete("cursor"); // eski süzgecin imleci yeni süzgeçte yanlış sayfa açar
        return next;
      },
      { replace: true },
    );
  return { lotMode, singleCustomer, groupFilter, lotList, setGroupFilter };
}
