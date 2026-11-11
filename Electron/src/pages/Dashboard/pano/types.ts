// Açılış panosu tel tipleri — backend `services/dashboard/pano.service.ts` (`PanoSummary`) ve
// `pano-hareketler.service.ts` (`PanoHareketler`) aynası. Kapalı/izinsiz kutu `null` gelir.

export const PANO_DONEMLERI = ["bugun", "hafta", "ay", "yil"] as const;
export type PanoDonem = (typeof PANO_DONEMLERI)[number];
export type PanoKova = "saat" | "gun" | "ay";

export interface PanoKpi { deger: number; onceki: number; degisimYuzde: number | null }
export interface PanoUrun { itemId: string; kod: string; ad: string; metre: number }

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
  dagilim: { boyut: "kumas"; dilimler: Array<{ itemId: string | null; ad: string; metre: number; yuzde: number }> } | null;
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

export type HareketTuru = "SIPARIS" | "SEVK" | "DOGRUDAN_SEVK" | "FASON_GIDEN" | "FASON_DONEN" | "MAL_KABUL" | "GELEN_BELGE";
export type MovementTargetType =
  | "order" | "shipment" | "directShipment" | "subcontractorDispatch" | "subcontractorReceipt" | "goodsReceipt" | "deliveryNote";

export interface PanoHareket {
  tur: HareketTuru;
  belgeNo: string;
  cari: string | null;
  /** Ölçülemiyorsa null (0 değil). */
  miktar: number | null;
  birim: "m" | "top" | null;
  zaman: string;
  hedef: { tur: MovementTargetType; id: string; isEmriId?: string | null };
}

export interface PanoHareketler {
  hareketler: PanoHareket[];
  turler: HareketTuru[];
}

/** Uç kapısı (`PANO_ROUTE_PERMISSIONS`) — izinsiz kullanıcıya katalog/kutu isteği atılmaz (403 toast'ı yok). */
export const PANO_UC_IZINLERI = [
  "report:quality", "report:sales", "report:subcontract", "report:inventory", "report:production", "report:finance",
  "warehouse:read", "roll:read", "loom:live-view", "gelen-belge:read", "shipping:read", "order:read", "finance:read",
  "workorder:read", "purchase-order:read", "weavingorder:read", "goods-receipt:read",
];
