// Pano kutusu → sıkı kutucuk görünümü (saf). Tel şekli fabrikanın açılış panosu kutularıdır
// (`Teks-Erp/src/services/dashboard/pano-kutu-*.ts`, panel aynası `Electron/src/pages/Dashboard/pano/box-types.ts`);
// savunmalı okunur, eksik alan "—". Uygulama ARİTMETİK YAPMAZ: değer, değişim yüzdesi ve oranlar fabrikadan.
import { formatMoney } from "../../lib/format";
import { UNIT } from "../../lib/labels/uretim";
import type { KpiLine, KpiTrend } from "../KpiCard";
import type { IconName } from "../icons";
import type { Domain } from "../tokens";
import { arr, num, obj, pct, qty, str } from "./read";

export interface KutuGorunum {
  /** Büyük değer; yalnız satırlardan oluşan kutuda null. */
  readonly value: string | null;
  readonly unit?: string;
  readonly caption?: string;
  readonly trend?: KpiTrend;
  readonly lines: readonly KpiLine[];
}

/** Grafik/takvim kutuları telefonda sıkı kutucuğa sığmaz; katalogda gösterilmez (panelde kalır). */
export const MOBILDE_YOK: ReadonlySet<string> = new Set(["egilim", "stokHareket", "nakitAkisi", "ajanda"]);

/** Kutu → renk kimliği + ikon + dokununca gidilecek bölüm. */
export const KUTU_META: Readonly<Record<string, { readonly domain: Domain; readonly icon: IconName; readonly route?: string }>> = {
  uretim: { domain: "uretim", icon: "construct-outline", route: "/uretim" },
  sevk: { domain: "sevkiyat", icon: "car-outline", route: "/sevkiyat" },
  siparis: { domain: "siparisler", icon: "receipt-outline", route: "/siparisler" },
  fason: { domain: "fason", icon: "git-branch-outline", route: "/uretim" },
  stok: { domain: "stok", icon: "cube-outline", route: "/stok" },
  ciro: { domain: "finans", icon: "cash-outline", route: "/finans" },
  tahsilat: { domain: "finans", icon: "wallet-outline", route: "/finans" },
  dagilim: { domain: "uretim", icon: "pie-chart-outline", route: "/uretim" },
  enCok: { domain: "uretim", icon: "podium-outline" },
  enCokMusteri: { domain: "cariler", icon: "people-outline", route: "/cariler" },
  uretimIstasyon: { domain: "uretim", icon: "git-network-outline", route: "/uretim" },
  isEmriDurum: { domain: "uretim", icon: "clipboard-outline", route: "/uretim" },
  kalite: { domain: "uretim", icon: "ribbon-outline" },
  tezgah: { domain: "uretim", icon: "speedometer-outline", route: "/uretim" },
  stokOzeti: { domain: "stok", icon: "layers-outline", route: "/stok" },
  fasonOzeti: { domain: "fason", icon: "business-outline", route: "/uretim" },
  emanet: { domain: "stok", icon: "archive-outline", route: "/stok" },
  bekleyen: { domain: "genel", icon: "hourglass-outline" },
  finans: { domain: "finans", icon: "trending-up-outline", route: "/finans" },
  sonHareketler: { domain: "genel", icon: "time-outline" },
};

const m = (v: unknown) => `${qty(v)} ${UNIT.metre}`;

/** Fabrikanın verdiği değişim yüzdesi → eğilim (yön ok şekliyle; artış iyi, düşüş uyarı). */
function trendOf(kpi: unknown): KpiTrend | undefined {
  const d = num(obj(kpi).degisimYuzde);
  if (d === null) return undefined;
  const direction = d > 0 ? "up" : d < 0 ? "down" : "flat";
  return { text: `${d > 0 ? "+" : ""}${pct(d)} önceki döneme göre`, direction, tone: d > 0 ? "iyi" : d < 0 ? "uyari" : "bilgi" };
}

const top3 = <T,>(rows: readonly T[], f: (r: T) => KpiLine): KpiLine[] => rows.slice(0, 3).map(f);

function moneyBox(d: unknown): KutuGorunum {
  const rows = arr(obj(d).tutarlar);
  const first = rows[0];
  if (!first) return { value: "Yok", lines: [] };
  return {
    value: formatMoney(first.deger, String(first.paraBirimi)),
    trend: trendOf(first),
    lines: rows.slice(1, 3).map((r) => ({ label: String(r.paraBirimi), value: formatMoney(r.deger, String(r.paraBirimi)) })),
  };
}

/** Kutu verisi → görünüm; tanınmayan kutu ya da veri yoksa null (kutucuk "veri yok" der). */
export function kutuGorunum(anahtar: string, veri: unknown): KutuGorunum | null {
  if (veri === null || veri === undefined) return null;
  const d = obj(veri);
  switch (anahtar) {
    case "uretim":
      return { value: qty(obj(d.metre).deger), unit: UNIT.metre, caption: `${qty(obj(d.top).deger)} ${UNIT.top}`, trend: trendOf(d.metre), lines: [] };
    case "sevk":
      return { value: qty(obj(d.metre).deger), unit: UNIT.metre, caption: `${qty(obj(d.irsaliye).deger)} irsaliye · brüt`, trend: trendOf(d.metre), lines: [] };
    case "siparis":
      return { value: qty(obj(d.adet).deger), unit: "sipariş", caption: m(obj(d.metre).deger), trend: trendOf(d.adet), lines: [] };
    case "fason":
      return { value: qty(obj(d.gidenMetre).deger), unit: UNIT.metre, caption: `giden · dönen ${m(d.donenMetre)}`, trend: trendOf(d.gidenMetre), lines: [] };
    case "stok":
      return {
        value: qty(d.mamulMetre), unit: UNIT.metre, caption: "mamul",
        lines: [{ label: "Ham", value: m(d.hamMetre) }, ...(num(d.iplikKg) !== null ? [{ label: "İplik", value: `${qty(d.iplikKg)} kg` }] : [])],
      };
    case "ciro":
    case "tahsilat":
      return moneyBox(d);
    case "tezgah":
      return {
        value: `${qty(d.calisan)}/${qty(d.toplam)}`, caption: "çalışan tezgah",
        lines: [{ label: "Duran", value: qty(d.duran), tone: (num(d.duran) ?? 0) > 0 ? "uyari" : undefined }, ...(num(d.issiz) !== null ? [{ label: "İşsiz", value: qty(d.issiz) }] : [])],
      };
    case "stokOzeti":
      return {
        value: qty(obj(d.mamul).metre), unit: UNIT.metre, caption: `mamul · ${qty(obj(d.mamul).top)} ${UNIT.top}`,
        lines: [
          { label: "Ham", value: m(obj(d.ham).metre) },
          { label: "Yarı mamul", value: m(obj(d.yariMamul).metre) },
          ...(num(d.iplikKg) !== null ? [{ label: "İplik", value: `${qty(d.iplikKg)} kg` }] : []),
        ],
      };
    case "fasonOzeti":
      return { value: qty(d.disaridakiMetre), unit: UNIT.metre, caption: `${qty(d.disaridakiTop)} ${UNIT.top} · ${qty(d.fasoncuSayisi)} fasoncu`, lines: [] };
    case "emanet":
      return { value: qty(d.metre), unit: UNIT.metre, caption: `${qty(d.top)} ${UNIT.top} müşteri malı`, lines: [] };
    case "bekleyen": {
      const lines: KpiLine[] = [];
      const belge = d.onayBekleyenBelge === null ? null : obj(d.onayBekleyenBelge);
      if (belge) lines.push({ label: "Onay bekleyen belge", value: qty(belge.toplam), tone: (num(belge.toplam) ?? 0) > 0 ? "uyari" : undefined });
      const hazir = d.sevkeHazir === null ? null : obj(d.sevkeHazir);
      if (hazir) lines.push({ label: "Sevke hazır", value: `${qty(hazir.sevkiyat)} · ${m(hazir.metre)}` });
      if (num(d.uretimeGonderilmemisSiparis) !== null) lines.push({ label: "Üretime gitmemiş sipariş", value: qty(d.uretimeGonderilmemisSiparis) });
      return { value: null, lines };
    }
    case "finans": {
      const rows = arr(d.alacaklar);
      const first = rows[0];
      if (!first) return { value: "Yok", caption: "açık alacak yok", lines: [] };
      const cur = String(first.paraBirimi);
      const late = (num(first.vadesiGecmis) ?? 0) > 0;
      return {
        value: formatMoney(first.acikAlacak, cur), caption: "açık alacak",
        lines: [
          { label: "Vadesi geçmiş", value: formatMoney(first.vadesiGecmis, cur), tone: late ? "kritik" : undefined },
          ...rows.slice(1, 3).map((r) => ({ label: String(r.paraBirimi), value: formatMoney(r.acikAlacak, String(r.paraBirimi)) })),
        ],
      };
    }
    case "isEmriDurum":
      return {
        value: qty(d.toplam), caption: "açık iş emri",
        lines: arr(d.durumlar).map((r) => ({ label: r.durum === "IN_PROGRESS" ? "Üretimde" : "Planlı", value: qty(r.adet) })),
      };
    case "dagilim":
      return { value: null, lines: top3(arr(d.dilimler), (r) => ({ label: str(r.ad) ?? "—", value: `${m(r.metre)} · ${pct(r.yuzde)}` })) };
    case "enCok": {
      const made = arr(d.uretilen);
      const sent = arr(d.sevkEdilen);
      const rows = made.length > 0 ? made : sent;
      return { value: null, caption: made.length > 0 ? "en çok üretilen" : "en çok sevk edilen", lines: top3(rows, (r) => ({ label: str(r.ad) ?? str(r.kod) ?? "—", value: m(r.metre) })) };
    }
    case "enCokMusteri": {
      const sent = arr(d.sevk);
      const ordered = arr(d.siparis);
      const rows = sent.length > 0 ? sent : ordered;
      return { value: null, caption: sent.length > 0 ? "en çok sevk edilen" : "en çok sipariş veren", lines: top3(rows, (r) => ({ label: str(r.ad) ?? "—", value: m(r.metre) })) };
    }
    case "uretimIstasyon":
      return {
        value: qty(obj(d.toplam).metre), unit: UNIT.metre, caption: `${qty(obj(d.toplam).top)} ${UNIT.top}`,
        lines: top3(arr(d.istasyonlar), (r) => ({ label: str(r.ad) ?? "—", value: m(r.metre) })),
      };
    case "kalite": {
      const first = d.birinciKalite === null ? null : obj(d.birinciKalite);
      const fire = obj(d.fire);
      return {
        value: first ? pct(first.yuzde) : "—", caption: first ? `${str(first.ad) ?? "1. kalite"} payı` : "kalite verisi yok",
        lines: [{ label: "Biten", value: m(d.bitenMetre) }, { label: "Hurda", value: pct(fire.hurdaYuzde) }],
      };
    }
    case "sonHareketler":
      return {
        value: null,
        lines: arr(d.hareketler).slice(0, 4).map((h) => ({
          label: [str(h.belgeNo), str(h.cari)].filter(Boolean).join(" · ") || "—",
          value: num(h.miktar) === null ? "—" : `${qty(h.miktar)} ${str(h.birim) ?? ""}`.trim(),
        })),
      };
    default:
      return null;
  }
}
