// =============================================================================
// DOKUMA İŞ EMRİ — sağ panel ("şu an ne hâlde")
// =============================================================================
// Satır tıklaması açar (kapalı işte de, salt okuma). Başlık listedeki satırdan
// çizilir; canlı bölümler `GET /weaving-orders/:id/overview`ten. İstek düşerse
// "kayıt yok" YAZILMAZ — hata + yeniden dene. Alan gelmezse bölüm çizilmez.
// Eylemler sayfanın mevcut diyaloglarına callback'tir (ikinci yazar yok).
// =============================================================================
import type { MouseEvent, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, CheckCircle2, Pencil, RotateCw, Truck } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PermissionGate } from "@/components/PermissionGate";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useTezgahEnabled } from "@/hooks/usePricingEnabled";
import "@/pages/Operations/WorkOrders/detail-v3/work-order-detail-v3.css";
import { TERIM } from "@/lib/terim";
import { weavingOrderService } from "./service";
import { WEAVING_ORDER_OVERVIEW_QUERY_KEY } from "./useWeavingOrderMutations";
import { WEAVING_KIND_LABEL, WEAVING_STATUS_META, formatDay, type WeavingExecutionKind, type WeavingOrder, type WeavingOrderStatus } from "./types";
import { isFasonSectionVisible } from "./fason/fason-summary";
import { isList, liveEmptyText } from "./overview/overview-model";
import { WeavingCostSection } from "./overview/WeavingCostSection";
import { FollowButton } from "@/components/bildirim/FollowButton";
import { BeamsSection, LiveRunsSection, OrderLinesSection, OverviewKpis, RecentDoffsSection, RecentRunsSection } from "./overview/OverviewSections";

const STATUS_PILL: Record<WeavingOrderStatus, string> = {
  PLANNED: "neutral",
  IN_PROGRESS: "run",
  COMPLETED: "ok",
  CANCELLED: "bad",
};

/** Panel açıkken canlı durum bu aralıkla tazelenir. */
export const OVERVIEW_REFETCH_MS = 20_000;

interface Props {
  /** Listedeki satır; `null` panel kapalı. */
  order: WeavingOrder | null;
  onClose: () => void;
  onEdit: (o: WeavingOrder) => void;
  onCloseOrder: (o: WeavingOrder) => void;
  onCancel: (o: WeavingOrder) => void;
  onFason: (o: WeavingOrder) => void;
}

export function WeavingOrderDetailSheet({ order, onClose, onEdit, onCloseOrder, onCancel, onFason }: Props) {
  const open = order !== null;
  const openTarget = useOpenTarget();
  const tezgahEnabled = useTezgahEnabled();
  const { hasPermission } = useRoleAccess();
  // Pasif sekme mount kalır; yoklama yalnız panel açık VE sekme görünürken.
  const isTabActive = useIsTabActive();
  const query = useQuery({
    queryKey: [WEAVING_ORDER_OVERVIEW_QUERY_KEY, order?.id],
    queryFn: () => weavingOrderService.overview(order!.id),
    enabled: open,
    refetchInterval: open && isTabActive ? OVERVIEW_REFETCH_MS : false,
  });
  const ov = query.data?.data;
  // Sunucunun taze DTO'su listedeki satırdan önce gelir; yoksa satırla çizilir.
  const wo = ov?.order ?? order;
  const kind = ov?.executionKind ?? wo?.executionKind;
  const canOpenFloor = tezgahEnabled && hasPermission("loom:live-view");
  const openMachine = canOpenFloor
    ? (machineId: string, e: MouseEvent) => {
        onClose();
        openTarget(`/operations/weaving-floor?tezgah=${encodeURIComponent(machineId)}`, e);
      }
    : undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="sr-only">
          <SheetTitle>{wo?.weavingOrderNumber ?? TERIM.dokumaIsEmri.tekil}</SheetTitle>
          <SheetDescription>{TERIM.dokumaIsEmri.tekil} — canlı durum</SheetDescription>
        </SheetHeader>
        {wo && (
          <div className="wo-v3 sheet" data-testid="weaving-order-sheet">
            <div className="sheet-wrap">
              <HeadBlock wo={wo} kind={kind} actions={<SheetActions wo={wo} onEdit={onEdit} onCloseOrder={onCloseOrder} onCancel={onCancel} onFason={onFason} />} />

              {query.isError ? (
                <div className="alert" role="alert" data-testid="wo-ov-error">
                  <div className="at">
                    <b>Canlı durum okunamadı.</b> Bu bir “kayıt yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya
                    ulaşamadı (modül kapalı, yetki yok, ağ, eski sunucu).
                  </div>
                  <button type="button" className="btn sm" onClick={() => void query.refetch()}>
                    <RotateCw className="h-3.5 w-3.5" /> Yeniden dene
                  </button>
                </div>
              ) : query.isLoading ? (
                <div className="card" style={{ height: 120 }} data-testid="wo-ov-loading" />
              ) : (
                ov && (
                  <>
                    {ov.progress && <OverviewKpis progress={ov.progress} kind={kind} />}
                    {isList(ov.liveRuns) && (
                      <LiveRunsSection list={ov.liveRuns} emptyText={liveEmptyText(wo.status, kind)} onOpenMachine={openMachine} />
                    )}
                    {isList(ov.recentRuns) && <RecentRunsSection list={ov.recentRuns} />}
                    {isList(ov.recentDoffs) && <RecentDoffsSection list={ov.recentDoffs} />}
                    {isList(ov.beams) && <BeamsSection list={ov.beams} />}
                  </>
                )
              )}
              {wo.orderLines && <OrderLinesSection lines={wo.orderLines} />}
              <WeavingCostSection itemId={wo.item.id} />
              {wo.status === "CANCELLED" && wo.cancelReason && (
                <div className="card emptybox">İptal gerekçesi: {wo.cancelReason}</div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function HeadBlock({ wo, kind, actions }: { wo: WeavingOrder; kind: WeavingExecutionKind | undefined; actions: ReactNode }) {
  return (
    <div className="sheet-head">
      <div className="sheet-id">
        <span className="wonum mono">{wo.weavingOrderNumber}</span>
        <span className={`pill ${STATUS_PILL[wo.status] ?? "neutral"}`}>
          <span className="dot" />
          {WEAVING_STATUS_META[wo.status]?.label ?? wo.status}
        </span>
      </div>
      <div className="sheet-sub">
        {wo.item.name} <span className="mono">({wo.item.code})</span>
        {wo.color ? ` · ${wo.color.name}` : " · renk yok (ham)"}
      </div>
      <div className="sheet-sub">
        {kind ? WEAVING_KIND_LABEL[kind] : ""}
        {wo.subcontractor && ` · ${wo.subcontractor.name}`}
        {` · Plan ${formatDay(wo.plannedStartDate)} → ${formatDay(wo.plannedEndDate)}`}
      </div>
      {actions}
    </div>
  );
}

function SheetActions({ wo, onEdit, onCloseOrder, onCancel, onFason }: Omit<Props, "order" | "onClose"> & { wo: WeavingOrder }) {
  const isOpen = WEAVING_STATUS_META[wo.status]?.open ?? false;
  const fason = isFasonSectionVisible(wo);
  // bildirim: takip kapalı işte de anlamlı (ilerideki bildirimler) — eylem şeridi takip için hep çizilir.
  return (
    <div className="sheet-actions">
      <FollowButton type="dokuma-isi" id={wo.id} />
      {fason && (
        <button type="button" className="btn" onClick={() => onFason(wo)}>
          <Truck className="h-3.5 w-3.5" /> Fason (sevk · kabul)
        </button>
      )}
      {isOpen && (
        <PermissionGate permission="weavingorder:write">
          <button type="button" className="btn" onClick={() => onEdit(wo)}>
            <Pencil className="h-3.5 w-3.5" /> Düzenle
          </button>
          <button type="button" className="btn" onClick={() => onCloseOrder(wo)}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Kapat
          </button>
          <button type="button" className="btn danger" style={{ marginLeft: "auto" }} onClick={() => onCancel(wo)}>
            <Ban className="h-3.5 w-3.5" /> İptal et
          </button>
        </PermissionGate>
      )}
    </div>
  );
}
