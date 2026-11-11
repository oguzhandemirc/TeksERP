// =============================================================================
// AÇILIŞ PANOSU — `GET /api/dashboard/pano` (salt okuma, YENİ İŞ MANTIĞI YOK)
// =============================================================================
// Her kutu var olan tek kaynaktan okunur (biten kumaş `_produced`, brüt sevk `_shipped`, Sipariş /
// Fason / Stok karneleri, liste özetleri, salon özeti, yaşlandırma). Kutu başına izin + modül
// kapısı; kapalı/izinsiz kutu `null` döner, hata değil. Termin/gecikme kutusu bilinçli YOK.
// `kutular` verilmeyen eski yanıt = ilk turun kutu kurucularının birleşimi (`pano-kutu-mevcut.ts`);
// seçimli yanıt `pano-kutular.service.ts`. Okumalar tx dışında paralel.
// =============================================================================
import { loadAccessContext } from "../reports/semantik/izin";
import { resolvePanoPencere, type PanoDonem, type PanoKova } from "./pano-donem";
import { PanoSources, panoGates, type PanoKullanici } from "./pano-kaynak";
import {
  consignedBox, distributionBox, loomBox, orderKpiBox, outsideBox, pendingBox, productionKpiBox, receivablesBox,
  shipmentKpiBox, stockKpiBox, stockSummaryBox, subcontractKpiBox, topItemsBox, trendBox,
  type BoxInput, type PanoDilim, type PanoKpi, type PanoUrun,
} from "./pano-kutu-mevcut";

export { PANO_TOP_N, type PanoKullanici } from "./pano-kaynak";
export type { PanoKpi, PanoUrun } from "./pano-kutu-mevcut";

/** Uç kapısının izin birleşimi — kullanıcının en az bir kutuyu görebilmesi gerekir. */
export const PANO_ROUTE_PERMISSIONS = [
  "report:quality", "report:sales", "report:subcontract", "report:inventory", "report:production", "report:finance",
  "warehouse:read", "roll:read", "loom:live-view", "gelen-belge:read", "shipping:read", "order:read", "finance:read",
  "workorder:read", "purchase-order:read", "weavingorder:read", "goods-receipt:read",
] as const;

export interface PanoSummary {
  donem: PanoDonem;
  aralik: { from: string; to: string };
  oncekiAralik: { from: string; to: string };
  olusturuldu: string;
  kpi: {
    uretim: { metre: PanoKpi; top: PanoKpi } | null;
    sevk: { metre: PanoKpi; irsaliye: PanoKpi } | null;
    siparis: { adet: PanoKpi; metre: PanoKpi } | null;
    fason: { gidenMetre: PanoKpi; donenMetre: number } | null;
    stok: { mamulMetre: number; hamMetre: number; iplikKg: number | null } | null;
  };
  egilim: { kova: PanoKova; noktalar: Array<{ anahtar: string; uretimMetre: number | null; sevkMetre: number | null }> };
  dagilim: { boyut: "kumas"; dilimler: PanoDilim[] } | null;
  enCok: { uretilen: PanoUrun[] | null; sevkEdilen: PanoUrun[] | null };
  tezgah: { toplam: number; calisan: number; duran: number; izlenmeyen: number; issiz: number | null; suAnYuzde: number | null } | null;
  stokOzeti: {
    mamul: { top: number; metre: number };
    ham: { top: number; metre: number };
    yariMamul: { top: number; metre: number };
    iplikKg: number | null;
    dusukStokKalem: null;
  } | null;
  fasonOzeti: { disaridakiMetre: number; disaridakiTop: number; fasoncuSayisi: number } | null;
  emanet: { top: number; metre: number } | null;
  bekleyen: {
    onayBekleyenBelge: { taslak: number; kismi: number; toplam: number } | null;
    sevkeHazir: { sevkiyat: number; metre: number } | null;
    uretimeGonderilmemisSiparis: number | null;
  };
  finans: { alacaklar: Array<{ paraBirimi: string; acikAlacak: number; vadesiGecmis: number }> } | null;
}

/** Kapı kapalıysa kaynak çağrılmaz, `null` döner. */
export function gated<T>(open: boolean, build: () => Promise<T>): Promise<T | null> {
  return open ? build() : Promise.resolve(null);
}

export function windowEcho(sources: PanoSources) {
  const { aralik, oncekiAralik, donem } = sources.window;
  return {
    donem,
    aralik: { from: aralik.from.toISOString(), to: aralik.to.toISOString() },
    oncekiAralik: { from: oncekiAralik.from.toISOString(), to: oncekiAralik.to.toISOString() },
    olusturuldu: sources.now.toISOString(),
  };
}

export async function getPanoSummary(donem: PanoDonem, user: PanoKullanici, now: Date = new Date()): Promise<PanoSummary> {
  const src = new PanoSources(resolvePanoPencere(donem, now), now);
  const can = panoGates(await loadAccessContext(user));
  const b: BoxInput = { src, can };
  const [uretim, sevk, siparis, fason, stok, egilim, dagilim, enCok, tezgah, stokOzeti, fasonOzeti, emanet, bekleyen, finans] = await Promise.all([
    gated(can.uretim, () => productionKpiBox(b)),
    gated(can.sevk, () => shipmentKpiBox(b)),
    gated(can.siparis, () => orderKpiBox(b)),
    gated(can.fason, () => subcontractKpiBox(b)),
    gated(can.stok, () => stockKpiBox(b)),
    trendBox(b),
    gated(can.uretim, () => distributionBox(b)),
    topItemsBox(b),
    gated(can.tezgah, () => loomBox(b)),
    gated(can.stok, () => stockSummaryBox(b)),
    gated(can.fasonOzeti, () => outsideBox(b)),
    can.emanet ? consignedBox(b) : Promise.resolve(null),
    pendingBox(b),
    gated(can.finans, () => receivablesBox(b)),
  ]);
  return { ...windowEcho(src), kpi: { uretim, sevk, siparis, fason, stok }, egilim, dagilim, enCok, tezgah, stokOzeti, fasonOzeti, emanet, bekleyen, finans };
}
