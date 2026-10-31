// `POST /api/cost/preview` ve `GET /api/cost/items…` yanıt şekilleri (backend `cost-calc.service` /
// `standard-cost.service` / `fabric-cost.helper presentCostResult` aynası). Tutarlar Decimal METNİDİR.
import type { Currency } from "@/pages/Finance/service";

export type DecStr = string;
export type CostSource = "KART" | "YAPI" | "PARAMETRE" | "OLCULMUS" | "ELLE";
export interface Sourced { value: DecStr | null; source: CostSource; flag?: string }
export interface CostPriceSnap { amount: DecStr; currency: Currency; source: CostSource; flag?: string }
export interface CostYarnSnap { yarnItemId: string | null; name: string; denier: Sourced; price: CostPriceSnap | null; picksInRepeat?: number }

export interface CostInputSnap {
  parameterSetId: string | null;
  warp: { warpSpecId: string | null; endsCount: number; takeUpPct: Sourced; wastePct: Sourced; yarn: CostYarnSnap } | null;
  weft: { weftSpecId: string | null; picksPerCm: Sourced; lengthCm: Sourced; wastePct: Sourced; yarns: CostYarnSnap[] } | null;
  loom: Record<"rpm" | "efficiencyPct" | "machineRateTry" | "laborRateTry" | "loomsPerOperator" | "energyKwhPerHour" | "energyPriceTry", Sourced>;
  beam: { prepCostTry: Sourced; lengthM: Sourced };
  finishing: { code: string; name: string; basis: "RAW_M" | "FINISHED_M"; price: CostPriceSnap | null } | null;
  /** SY-G1 ek işlemler — yalnız doluyken gelir. */
  processes?: Array<{ code: string; name: string; basis: "RAW_M" | "FINISHED_M"; price: CostPriceSnap | null }>;
  lengthShrinkPct: Sourced;
  fabricWastePct: Sourced;
  overheadPct: Sourced;
  extra: { amountTry: DecStr; label: string | null } | null;
  /** SY-D2: yalnız atkı ücreti yönteminde gelir (backend `CostInput.loomPick` aynası). */
  loomPick?: { rate: CostPriceSnap | null };
}

export interface CostLineOut {
  sira: number; bilesen: string; etiket: string; iplikId: string | null; miktar: DecStr | null; birim: string | null;
  birimFiyatTl: DecStr | null; tutarTlM: DecStr;
}
export interface CostResultOut {
  // SY-D2: atkı ücreti yönteminde devir/randıman bilinmiyorsa tezgah hızı null ("—").
  satirlar: CostLineOut[]; cozguKgM: DecStr; atkiKgM: DecStr; tezgahMSaat: DecStr | null; hamTlM: DecStr; mamulTlM: DecStr | null;
  /** Kayıtlı sürümde saklanmaz → null (zincirde çizilmez). */
  saglamTlM: DecStr | null; genelGiderTlM: DecStr | null; standartTlM: DecStr;
}
export type FxRates = Partial<Record<Currency, DecStr>>;
export interface FxSnapshot { tarih: string; kaynak: "ELLE" | "FINANS" | "YOK"; kurlar: FxRates }
export interface YarnPriceSuggestion {
  iplikId: string;
  sonGiris: { birimFiyat: DecStr; paraBirimi: string; tarih: string } | null;
  alisFiyati: { birimFiyat: DecStr; paraBirimi: string; tarih: string } | null;
}
export interface MeasuredWarpWaste { firePct: DecStr; leventSayisi: number; baslangic: string; bitis: string }

export interface CostPreview {
  sonuc: CostResultOut | null;
  eksikler: string[];
  uyarilar: string[];
  girdi: CostInputSnap;
  kurlar: FxSnapshot;
  oneriler: { fx: FxRates; yarnPrices: YarnPriceSuggestion[]; warpWaste: MeasuredWarpWaste | null };
}

export type StructureStatus = "YAPI_EKSIK" | "VARSAYILAN" | "TAM";

export interface CostVersion {
  id: string; surumNo: number; durum: "ACTIVE" | "SUPERSEDED"; hamTlM: DecStr; mamulTlM: DecStr | null; standartTlM: DecStr;
  cozguKgM: DecStr; atkiKgM: DecStr; tezgahMSaat: DecStr | null; kurlar: FxSnapshot; uyarilar: string[]; gerekce: string | null;
  hesaplananAt: string; gecersizAt: string | null; geriAlinanSurumId: string | null;
  satirlar?: CostLineOut[];
}
