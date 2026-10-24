// "Şu an nerede" — liste satırındaki `konum` özetinin görünüm modeli (saf; testli).
// Kaynak backend `helpers/workorder-location.helper.ts`: canlı topların şu anki
// istasyon dağılımı + sınıf. Burada yalnız gösterim kararı verilir, sayı türetilmez.
import type { StationKind, WorkOrderStatus } from "@/types/enums";

export type WorkOrderLocationClass = "BASLAMADI" | "TEK_ISTASYON" | "BOLUNMUS" | "FASONDA" | "BITTI";

export interface WorkOrderLocationStation {
  istasyonId: string;
  ad: string;
  tur: StationKind;
  dis: boolean;
  topSayisi: number;
  metre: number;
  fasondaTop: number;
  fasoncular: string[];
}

export interface WorkOrderLocation {
  sinif: WorkOrderLocationClass;
  canliTop: number;
  istasyonlar: WorkOrderLocationStation[];
}

/** "Özel" süzgeç grubunun etiketleri — backend `filter[konumSinifi]` değerleri. */
export const LOCATION_CLASS_FILTER_OPTIONS: { value: WorkOrderLocationClass; label: string }[] = [
  { value: "BOLUNMUS", label: "Birden çok istasyonda" },
  { value: "FASONDA", label: "Fasonda" },
  { value: "BASLAMADI", label: "Henüz başlamadı" },
  { value: "BITTI", label: "Bitti" },
];

/** Açılır kartta en çok bu kadar istasyon satırı; fazlası "+N diğer". */
export const LOCATION_CARD_MAX_ROWS = 5;

export type LocationView =
  | { kind: "unknown" }
  | { kind: "cancelled" }
  | { kind: "not-started" }
  | { kind: "done"; label: string; hint: string }
  | {
      kind: "stations";
      fason: boolean;
      primary: WorkOrderLocationStation;
      /** Çipte gösterilecek ad: fasondaysa fasoncu adı, değilse istasyon adı. */
      primaryLabel: string;
      extra: number;
      rows: WorkOrderLocationStation[];
      hiddenCount: number;
      total: number;
    };

/** İstasyonun tek satırlık açıklaması: "Boyahane · 8 top" (+ fason ayrıntısı). */
export function stationDetail(s: WorkOrderLocationStation): string {
  if (!s.dis || s.fasondaTop === 0) return s.dis ? "sevk bekliyor" : "";
  const firm = s.fasoncular.length ? s.fasoncular.join(", ") : "fasoncuda";
  return s.fasondaTop === s.topSayisi ? firm : `${s.fasondaTop} top ${firm} · ${s.topSayisi - s.fasondaTop} sevk bekliyor`;
}

export function locationView(konum: WorkOrderLocation | undefined, status: WorkOrderStatus): LocationView {
  if (!konum) return { kind: "unknown" };
  const list = konum.istasyonlar;
  const primary = list[0];
  if (!primary) {
    if (status === "CANCELLED" || status === "SUPERSEDED") return { kind: "cancelled" };
    if (konum.sinif === "BASLAMADI") return { kind: "not-started" };
    return status === "COMPLETED"
      ? { kind: "done", label: "Tamamlandı", hint: "Üretimde canlı top kalmadı." }
      : { kind: "done", label: "Üretim bitti", hint: "Üretimde canlı top kalmadı; iş emri henüz kapatılmadı." };
  }
  const fason = konum.sinif === "FASONDA";
  return {
    kind: "stations",
    fason,
    primary,
    primaryLabel: (fason ? primary.fasoncular[0] : undefined) ?? primary.ad,
    extra: list.length - 1,
    rows: list.slice(0, LOCATION_CARD_MAX_ROWS),
    hiddenCount: Math.max(0, list.length - LOCATION_CARD_MAX_ROWS),
    total: konum.canliTop,
  };
}

/** Dışa aktarma / tooltip için düz metin: "Kurşun 12 top, Boyahane 8 top". */
export function locationText(konum: WorkOrderLocation | undefined, status: WorkOrderStatus): string {
  const v = locationView(konum, status);
  switch (v.kind) {
    case "unknown":
    case "cancelled":
      return "";
    case "not-started":
      return "Başlamadı";
    case "done":
      return v.label;
    case "stations":
      return (konum?.istasyonlar ?? []).map((s) => `${s.ad} ${s.topSayisi} top`).join(", ");
  }
}

/**
 * Süzgeçte gösterilecek istasyon: pasif ve rota adımı OLAMAYAN istasyon hariç (tezgah/devere,
 * `allowAsWorkOrderStep=false` — KK1 girişi, Sevkiyat). Orada iş emri topu hiç durmaz; her zaman
 * boş liste döndüren seçenek "bozuk süzgeç" gibi okunur (2026-08-12 'İstasyon' süzgeci emsali).
 */
export interface LocationFilterStation {
  id: string;
  name: string;
  type: "INTERNAL" | "EXTERNAL";
  kind: StationKind;
  isActive: boolean;
  allowAsWorkOrderStep?: boolean;
}

// Üretim akışı sırası (station-colors: KK1 → Fason → Kurşun/KK2 → Tambur → Depo).
const FLOW_RANK: Partial<Record<StationKind, number>> = { RAW_QC: 0, PROCESS_QC: 2, TAMBUR: 3, SHIPPING: 4, OTHER: 5 };
const NOT_A_ROUTE_STEP: ReadonlySet<StationKind> = new Set<StationKind>(["WEAVING", "WARPING"]);

export function stationsForLocationFilter<T extends LocationFilterStation>(stations: readonly T[]): T[] {
  const rank = (s: T) => (s.type === "EXTERNAL" ? 1 : (FLOW_RANK[s.kind] ?? 5));
  return stations
    .filter((s) => s.isActive && s.allowAsWorkOrderStep !== false && !NOT_A_ROUTE_STEP.has(s.kind))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "tr"));
}

/** Ad zaten "fason" diyorsa ("Boyahane (Fason)") ek etiket basılmaz. */
export function needsFasonTag(s: { type: string; name: string }): boolean {
  return s.type === "EXTERNAL" && !/fason/i.test(s.name);
}
