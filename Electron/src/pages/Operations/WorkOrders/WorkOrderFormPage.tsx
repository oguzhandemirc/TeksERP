import { useEffect, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePreferences } from "@/providers/PreferencesProvider";
import { fireConfetti } from "@/lib/confetti";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useTabsStore } from "@/store/tabs";
import { useTargetQuantityEnabled } from "@/hooks/usePricingEnabled";
import { workOrderService } from "./service";
import { WorkOrderFormView } from "./WorkOrderFormView";
import { buildPayload, type CreatePayload } from "./workOrderPayload";
import type { WoSeedTarget } from "./workOrderPrefill";
import type { PickedOrderLine } from "./OrderPickerDialog";
import type { WorkOrder } from "./types";
import { toastServerSuccess } from "@/lib/serverNotes";

const LIST_PATH = "/operations/work-orders";

/**
 * İş emri Oluştur / Düzenle — tam sayfa (kendi sekmesinde). Modal'ın yerini alır:
 * sticky başlık (geri + kimlik) + `WorkOrderFormView`. Create modunda gezinme
 * state'inden tohumlanır (siparişten WO / Denge stoğa üret); edit modunda WO'yu
 * locks'larıyla çeker. Oluşturma başarılıysa yeni iş emrinin detayına geçer.
 */
export function WorkOrderFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const location = useLocation();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const qc = useQueryClient();
  const { prefs, setPreference } = usePreferences();

  /**
   * Kategori → en son seçilen fason firma (KİŞİSEL hafıza, 2026-08-09).
   *
   * ⚠️ Tercih KAPALIYKEN de yazılır: anahtarı sonra çeviren kullanıcı boş bir
   * hafızayla karşılaşmasın. Okuma tarafı `useDesignerSteps.pickDefaultFirmId`.
   * Yalnız kategori + firma İKİSİ de dolu olan adımlar sayılır — biri eksikse
   * hangi kategoriye yazılacağı belirsizdir ve yanlış kategoriye yazmak, sonraki
   * iş emrinde sessizce yanlış firma önerirdi.
   */
  const rememberLastSubcontractors = (payload: CreatePayload) => {
    const next = { ...(prefs.workOrders?.lastSubcontractorByCategory ?? {}) };
    let changed = false;
    for (const s of payload.stepPlanning ?? []) {
      if (s.requiredCategoryId && s.plannedSubcontractorId) {
        if (next[s.requiredCategoryId] !== s.plannedSubcontractorId) {
          next[s.requiredCategoryId] = s.plannedSubcontractorId;
          changed = true;
        }
      }
    }
    if (!changed) return; // gereksiz PUT atma (tercih blob'u her kayıtta gitmesin)
    setPreference({
      workOrders: { ...(prefs.workOrders ?? {}), lastSubcontractorByCategory: next },
    });
  };
  const targetQuantityEnabled = useTargetQuantityEnabled();
  // Başlık satırındaki sağ slot — form "Şablon seç" butonunu buraya portal'lar.
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  // İdempotency anahtarı — bu sayfa (sekme) bir create form-oturumudur. Mount'ta
  // üretilir; timeout sonrası tekrar basış aynı token'ı taşır → backend cached WO
  // döner (mükerrer İE + refakat kartı önlenir). Başarıda sayfa navigate ile
  // unmount olduğundan yenileme gerekmez; yalnız create yolunda kullanılır.
  const [clientToken] = useState(() => crypto.randomUUID());

  // Create: seed gezinme state'inden (siparişten WO / Denge "stoğa üret").
  const seed = location.state as {
    seedPickedLines?: PickedOrderLine[];
    seedTarget?: WoSeedTarget;
  } | null;

  // Edit: WO'yu (locks dahil) çek. Form WO yüklenmeden tohumlanamaz.
  const detail = useQuery({
    queryKey: ["work-order-detail", id],
    queryFn: () => workOrderService.getById(id!),
    enabled: isEdit,
    staleTime: 60_000,
  });
  const wo = detail.data?.data ?? null;

  // Sekme başlığını anlamlı yap (detay sayfasıyla aynı desen).
  useEffect(() => {
    const title = isEdit
      ? wo?.workOrderNumber
        ? `Düzenle · ${wo.workOrderNumber.slice(-6)}`
        : "İş Emrini Düzenle"
      : "Yeni İş Emri";
    const path = isEdit
      ? `/operations/work-orders/${id}/edit`
      : "/operations/work-orders/new";
    const tab = useTabsStore.getState().tabs.find((t) => t.path === path);
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, title);
  }, [isEdit, id, wo?.workOrderNumber]);

  const createMut = useMutation({
    mutationFn: (payload: CreatePayload) =>
      workOrderService.create(payload as unknown as Partial<WorkOrder>),
    onSuccess: (res, payload) => {
      // KİŞİSEL HAFIZA (2026-08-09): kategori → en son seçilen fason firma.
      // ⚠️ Tercih KAPALIYKEN de yazılır — anahtarı sonra çeviren kullanıcı boş
      // bir hafızayla karşılaşmasın. Okuma tarafı `pickDefaultFirmId`.
      rememberLastSubcontractors(payload);
      toastServerSuccess(res, "İş emri oluşturuldu.");
      fireConfetti();
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      // Siparişten üretim emri açıldı → sipariş listesindeki "İş Emri" rollup
      // rozeti (workOrderLinks türevi) bayat kalmasın.
      void qc.invalidateQueries({ queryKey: ["orders"] });
      const newId = res.data?.id;
      // Yeni iş emrinin tam sayfa detayına geç (bu sekmede yerinde).
      navigateActive(newId ? `/operations/work-orders/${newId}` : LIST_PATH);
    },
  });

  const replaceMut = useMutation({
    mutationFn: (payload: CreatePayload) =>
      workOrderService.replace(id!, payload as unknown as Partial<WorkOrder>),
    onSuccess: (res) => {
      toastServerSuccess(res, "İş emri güncellendi.");
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", id] });
      // Tebdil/güncelleme bağları değiştirebilir → sipariş rollup rozetini tazele.
      void qc.invalidateQueries({ queryKey: ["orders"] });
      navigateActive(`/operations/work-orders/${id}`);
    },
  });

  const handleCancel = () =>
    navigateActive(isEdit ? `/operations/work-orders/${id}` : LIST_PATH);

  const backPath = isEdit ? `/operations/work-orders/${id}` : LIST_PATH;
  const backLabel = isEdit ? "İş Emri" : "İş Emirleri";
  const backTo = { label: backLabel, to: backPath };

  const notFound = isEdit && !detail.isLoading && !wo;

  return (
    <PageShell>
      <PageHeader
        title={isEdit ? "İş Emrini Düzenle" : "Yeni İş Emri"}
        description={
          isEdit
            ? wo?.workOrderNumber
            : "Sipariş bağla ya da stoğa üret — rota ve hedefi belirle."
        }
        parent={backTo}
        onBack={() => navigateActive(backPath)}
        // Sağ aksiyon slotu — yeni kayıtta "Şablon seç" butonu buraya portal'lanır.
        actions={<div ref={setHeaderSlot} className="flex items-center" />}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        {isEdit && detail.isLoading && (
          <div className="mx-auto w-full max-w-3xl space-y-3 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {notFound && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            İş emri bulunamadı.
          </div>
        )}
        {(!isEdit || wo) && (
          <WorkOrderFormView
            workOrder={wo}
            initialPickedLines={isEdit ? undefined : seed?.seedPickedLines}
            initialTarget={isEdit ? undefined : seed?.seedTarget ?? undefined}
            onSubmit={async (v, meta) => {
              const payload = buildPayload(v, meta, targetQuantityEnabled);
              if (isEdit) await replaceMut.mutateAsync(payload);
              else await createMut.mutateAsync({ ...payload, clientToken });
            }}
            isSubmitting={isEdit ? replaceMut.isPending : createMut.isPending}
            onCancel={handleCancel}
            headerSlot={headerSlot}
          />
        )}
      </div>
    </PageShell>
  );
}
