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
import { NewSackDialog, useOpenSackInLot } from "./NewSackDialog";
import { PackingLotListView } from "./PackingLotListView";
import { PackingLotHeaderMenu, PackingLotTitleExtra } from "./PackingLotHeader";
import { isLotMode, singleCustomerFromFilter } from "./packingLotUi";
import { usePackingGroupMode, usePackingGroupsEnabled } from "@/hooks/usePricingEnabled";
import { UNGROUPED_FILTER_VALUE, type EditorTarget, type SackSearchRow } from "./types";

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
  const { lotMode, singleCustomer, groupFilter, lotId, lotList, sacksView, setGroupFilter, openSacksView, closeSacksView } = useLotRouting(gateOpen, searchParams, setSearchParams);
  // Parti içindeyken "Yeni Çuval" pencere açmaz — doğrudan o partide, sıradaki numarayla.
  const directOpen = useOpenSackInLot(lotId, setTarget);
  // Geri oku dört seviyeli: cari listesi → karolar · parti içi → parti listesi · çuval görünümü → parti listesi · liste → gelinen kapı adımı.
  const inWorkspace = !gateOpen && lotMode && !!singleCustomer;
  const onBack =
    gateStep === "customers" ? () => setGateStep("choice")
      : inWorkspace && groupFilter ? () => setGroupFilter(null)
      : inWorkspace && sacksView ? closeSacksView
      : !gateOpen && returnStep ? () => backToGate(returnStep)
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
        // Kırıntı ("Operasyon ›") bu ekranda gizli — başlık kutuları (cari · parti) kimliği taşır (saha 2026-09-22).
        parent={null}
        actionsAlign="center"
        // Başlık kutusu HER görünümde çizilir (kapıda "seçin", tümünde "Tümü") — başlık
        // yüksekliği cari seçilince ZIPLAMASIN (saha 2026-09-22).
        titleExtra={<PackingLotTitleExtra customerId={!gateOpen && lotMode ? singleCustomer : null} groupFilter={groupFilter || null} />}
        // TEK GERİ YÜZEYİ: cari listesi adımındayken başlıktaki ok bir adım geri
        // alır (kapının seçim karolarına). Diğer durumlarda `undefined` — ok
        // varsayılan davranışına (sekme geçmişi → breadcrumb üstü) düşer.
        onBack={onBack}
        actions={
          <HeaderActions
            showCustomerPick={!gateOpen && !(lotMode && singleCustomer)}
            lotMenuFor={!gateOpen && lotMode && singleCustomer && groupFilter ? groupFilter : null}
            onPickCustomer={() => backToGate("choice")}
            onNewSack={directOpen ? directOpen.open : () => setNewOpen(true)}
            newSackPending={directOpen?.pending ?? false}
            onLotDeleted={() => setGroupFilter(null)}
          />
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
        <PackingLotListView
          customerId={singleCustomer!}
          onOpen={(v) => setGroupFilter(v)}
          onOpenUnweighed={() => openSacksView({ "filter[weighed]": "false" })}
        />
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
  // `view=sacks`: cari çalışma alanında parti seçmeden çuval listesi (ör. "Tartılmamış"
  // kartı → havuz + partiler, tartı süzgeciyle). Geri oku bu anahtarı ve süzgecini siler.
  const sacksView = searchParams.get("view") === "sacks";
  const lotList = !gateOpen && lotMode && !!singleCustomer && !groupFilter && !sacksView;
  /** Gerçek bir partinin içi (havuz değil) — doğrudan çuval açma ve ⋮ menüsü bunu okur. */
  const lotId = !gateOpen && lotMode && !!singleCustomer && groupFilter && groupFilter !== UNGROUPED_FILTER_VALUE ? groupFilter : null;
  const openSacksView = (filters: Record<string, string>) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("view", "sacks");
        for (const [k, v] of Object.entries(filters)) next.set(k, v);
        next.delete("cursor");
        return next;
      },
      { replace: true },
    );
  const closeSacksView = () =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("view");
        next.delete("filter[weighed]");
        next.delete("cursor");
        return next;
      },
      { replace: true },
    );
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
  return { lotMode, singleCustomer, groupFilter, lotId, lotList, sacksView, setGroupFilter, openSacksView, closeSacksView };
}

/** Başlık eylemleri — Cari Seç (yalnız cari alanı dışında) · Yeni Çuval · Yenile · parti içi ⋮. */
function HeaderActions(p: {
  showCustomerPick: boolean;
  lotMenuFor: string | null;
  onPickCustomer: () => void;
  onNewSack: () => void;
  newSackPending: boolean;
  onLotDeleted: () => void;
}) {
  return (
    <>
      {p.showCustomerPick && (
        // Kapıya dönüş — cari değiştirmenin tek tuşluk yolu. Parti modunda cari
        // çalışma alanında ÇİZİLMEZ: cari başlıkta, değiştirmek geri okuyla (saha 2026-09-22).
        <Button variant="outline" size="sm" className="gap-1.5" onClick={p.onPickCustomer}>
          <Users className="h-4 w-4" /> Cari Seç
        </Button>
      )}
      <Button size="sm" onClick={p.onNewSack} disabled={p.newSackPending} className="gap-1.5">
        <PackagePlus className="h-4 w-4" /> {p.newSackPending ? "Açılıyor…" : "Yeni Çuval"}
      </Button>
      <RefreshButton queryKey="sack-search" extraKeys={[["packing"]]} successMessage="Çuval listesi yenilendi" />
      {/* Parti içi ⋮: adlandır · havuza çıkar · depoya çek · sil; silinince parti listesine dön. */}
      {p.lotMenuFor && <PackingLotHeaderMenu groupFilter={p.lotMenuFor} onDeleted={p.onLotDeleted} />}
    </>
  );
}
