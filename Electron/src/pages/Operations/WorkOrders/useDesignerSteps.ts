import { useState } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";
import { useQueryClient } from "@tanstack/react-query";
import { arrayMove } from "@dnd-kit/sortable";
import { toast } from "sonner";
import { stationService } from "@/pages/Stations/service";
import { routeService } from "@/pages/Routes/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { DesignerStep } from "./RouteDesignerDialog";

let counter = 0;
const newClientId = () => `ds-${Date.now()}-${++counter}`;

interface StationLike {
  id: string;
  code: string;
  name: string;
  type: "INTERNAL" | "EXTERNAL";
  kind?: string | null;
  defaultCategoryId?: string | null;
}

function stationToDesigner(s: StationLike): Pick<
  DesignerStep,
  "stationId" | "stationCode" | "stationName" | "stationType" | "stationKind" | "requiredCategoryId"
> {
  return {
    stationId: s.id,
    stationCode: s.code,
    stationName: s.name,
    stationType: s.type,
    stationKind: s.kind ?? null,
    requiredCategoryId: s.type === "EXTERNAL" ? s.defaultCategoryId ?? null : null,
  };
}

// Favori firma listesinden kategorinin favorisini seç (client-side eşleşme).
function pickFavoriteFirmId(
  favs: { id: string; isFavorite: boolean; categories: { categoryId: string }[] }[],
  categoryId: string,
): string | null {
  return (
    favs.find(
      (f) => f.isFavorite && f.categories.some((c) => c.categoryId === categoryId),
    )?.id ?? null
  );
}

/**
 * Fason adımının VARSAYILAN firması — kişisel tercihe göre (2026-08-09).
 *
 * Saha isteği: *"son seçilen fasoncu otomatik gelsin; favori geliyor şu an."*
 * Kullanıcı kararı: **açılır-kapanır kişisel tercih** — planlamacılar farklı
 * çalışıyor, birini diğerine dayatmak yerine seçtiriyoruz.
 *
 * ⚠️ `lastUsed` seçiliyken bile geçmiş YOKSA favoriye düşülür. Boş bırakmak,
 * yeni bir kategoride tercihi açan kullanıcıya "hiçbir şey gelmiyor" dedirtirdi.
 * ⚠️ Varsayılan `favorite` = bugünkü davranış (kimsenin alışkanlığı habersiz
 * değişmez).
 *
 * SAF fonksiyon — bekçi doğrudan bunu sınar.
 */
export function pickDefaultFirmId(
  mode: "favorite" | "lastUsed" | undefined,
  favs: { id: string; isFavorite: boolean; categories: { categoryId: string }[] }[],
  lastByCategory: Record<string, string> | undefined,
  categoryId: string,
): string | null {
  const fav = pickFavoriteFirmId(favs, categoryId);
  if (mode !== "lastUsed") return fav;
  return lastByCategory?.[categoryId] ?? fav;
}

export function useDesignerSteps(initialSteps?: DesignerStep[]) {
  // KİŞİSEL tercih (2026-08-09): fason varsayılanı favori mi, son seçilen mi.
  // Varsayılan "favorite" = bugünkü davranış.
  const { prefs } = usePreferences();
  const firmMode = prefs.workOrders?.subcontractorDefault;
  const lastByCategory = prefs.workOrders?.lastSubcontractorByCategory;
  const qc = useQueryClient();
  const [steps, setSteps] = useState<DesignerStep[]>(initialSteps ?? []);

  const reset = (next?: DesignerStep[]) => setSteps(next ?? []);

  const updateStep = (clientId: string, patch: Partial<DesignerStep>) => {
    setSteps((prev) =>
      prev.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s)),
    );
  };

  const removeStep = (clientId: string) => {
    setSteps((prev) => prev.filter((s) => s.clientId !== clientId));
  };

  // Sürükle-bırak ile keyfi yeniden sıralama (active → over konumuna).
  const reorder = (activeId: string, overId: string) => {
    setSteps((prev) => {
      const from = prev.findIndex((s) => s.clientId === activeId);
      const to = prev.findIndex((s) => s.clientId === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      return arrayMove(prev, from, to);
    });
  };

  const moveStep = (clientId: string, dir: -1 | 1) => {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.clientId === clientId);
      const target = idx + dir;
      if (idx === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      if (!item) return prev;
      next.splice(target, 0, item);
      return next;
    });
  };

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        clientId: newClientId(),
        stationId: "",
        stationCode: "",
        stationName: "",
        stationType: "INTERNAL",
        stationKind: null,
        notes: "",
        requiredCategoryId: null,
        plannedSubcontractorId: null,
      },
    ]);
  };

  /**
   * Rota şablonunu akışa yükler ve şablonun HEDEFİNİ (renk + özellik) çağırana
   * DÖNER — hedef adım bazında saklanır ama iş emrinde tek/düz alandır, o yüzden
   * çeviri burada yapılır: renk için SON renk veren adım kazanır (yeniden boyama
   * varsa nihai renk odur), özellikler ise birleşiktir (her adım kendi katkısını
   * ekler). Hedefi burada forma YAZMAYIZ — sipariş bağlı iş emrinde renk/özellik
   * sipariş kaleminden gelir ve şablon onu ezmemeli; kararı çağıran verir.
   */
  const seedFromRoute = async (
    routeId: string,
  ): Promise<{ colorId: string | null; propertyIds: string[] } | null> => {
    try {
      const res = await qc.fetchQuery({
        queryKey: ["route", routeId, "designer-seed"],
        queryFn: () => routeService.getById(routeId),
        staleTime: 60_000,
      });
      const route = res.data;
      if (!route) return null;
      let newSteps: DesignerStep[] = (route.steps ?? []).map((s) => {
        const base = {
          clientId: newClientId(),
          ...stationToDesigner({
            id: s.station?.id ?? s.stationId,
            code: s.station?.code ?? "",
            name: s.station?.name ?? "",
            type: s.station?.type ?? "INTERNAL",
            kind: s.station?.kind ?? null,
            defaultCategoryId: s.station?.defaultCategoryId ?? null,
          }),
          notes: s.defaultNotes ?? "",
        };
        // Saha #14: şablon artık fason planlamasını saklıyor — kayıtlı değer
        // varsa onu kullan (kategori dahil); yoksa istasyon default'u kalır.
        return {
          ...base,
          requiredCategoryId: s.requiredCategoryId ?? base.requiredCategoryId,
          plannedSubcontractorId: s.plannedSubcontractorId ?? null,
        };
      });
      // Fason adımlarına (şablonda firma kayıtlı DEĞİLSE) kategorinin favori
      // firmasını default ata.
      if (
        newSteps.some(
          (s) => s.stationType === "EXTERNAL" && s.requiredCategoryId && !s.plannedSubcontractorId,
        )
      ) {
        const favs = await fetchFavoriteFirms();
        newSteps = newSteps.map((s) =>
          s.stationType === "EXTERNAL" && s.requiredCategoryId && !s.plannedSubcontractorId
            ? { ...s, plannedSubcontractorId: pickDefaultFirmId(firmMode, favs, lastByCategory, s.requiredCategoryId) }
            : s,
        );
      }
      setSteps(newSteps);

      const sorted = [...(route.steps ?? [])].sort((a, b) => a.sequence - b.sequence);
      let colorId: string | null = null;
      const propertyIds = new Set<string>();
      for (const s of sorted) {
        if (s.plannedColorId) colorId = s.plannedColorId; // son renk veren adım kazanır
        for (const p of s.plannedProperties ?? []) propertyIds.add(p.propertyId);
      }
      return { colorId, propertyIds: [...propertyIds] };
    } catch {
      toast.error("Şablon yüklenemedi.");
      return null;
    }
  };

  // Favori (isFavorite) firmaları getir — client-side kategoriye göre eşleşir.
  const fetchFavoriteFirms = async () => {
    try {
      const res = await qc.fetchQuery({
        queryKey: ["subcontractors", "favorites"],
        queryFn: () =>
          subcontractorService.getAll({
            page: 1,
            pageSize: 100,
            sortBy: "name",
            sortOrder: "asc",
            filters: { isFavorite: "true", isActive: "true" },
          }),
        staleTime: 60_000,
      });
      return res.data ?? [];
    } catch {
      return [];
    }
  };

  const handleStationPick = async (clientId: string, stationId: string | null) => {
    if (!stationId) {
      updateStep(clientId, {
        stationId: "",
        stationCode: "",
        stationName: "",
        stationType: "INTERNAL",
        stationKind: null,
        requiredCategoryId: null,
        plannedSubcontractorId: null,
      });
      return;
    }
    try {
      const res = await qc.fetchQuery({
        queryKey: ["station", stationId, "designer"],
        queryFn: () => stationService.getById(stationId),
        staleTime: 5 * 60_000,
      });
      const station = res.data;
      if (!station) return;
      const designer = stationToDesigner(station);
      // Fason adımıysa kategorinin favori firmasını default seç.
      let plannedSubcontractorId: string | null = null;
      if (designer.stationType === "EXTERNAL" && designer.requiredCategoryId) {
        const favs = await fetchFavoriteFirms();
        plannedSubcontractorId = pickDefaultFirmId(firmMode, favs, lastByCategory, designer.requiredCategoryId);
      }
      updateStep(clientId, { ...designer, plannedSubcontractorId });
    } catch {
      toast.error("İstasyon bilgisi yüklenemedi.");
    }
  };

  return {
    steps,
    reset,
    addStep,
    removeStep,
    moveStep,
    reorder,
    updateStep,
    seedFromRoute,
    handleStationPick,
  };
}
