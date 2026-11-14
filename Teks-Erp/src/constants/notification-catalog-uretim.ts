// =============================================================================
// BİLDİRİM KATALOĞU — Üretim · Dokuma · Kalite · Kurşun · Tambur · Bakım parça dosyası (S2, geniş katalog 2026-11-14)
// =============================================================================
// `NOTIFICATION_CATALOG`a yayılır (tek katalog; ayrı dosya yalnız boyut içindir). OLAY kaynakları (tek yayma
// noktaları) `services/notification-sources/uretim.ts`; KOSUL kaynakları `uretim-kosul.ts`; özetler `uretim-ozet.ts`
// (`jobs/notification-digest.job.ts` yazar). Yük tutar taşımaz; `{kullanici}` emit helper'ı aktörden doldurur (K4).
// Top başı olaylar tekil tür değildir (K3): biten kumaş saatlik/gün sonu özetinde sayılır.
// =============================================================================
import { z } from "zod";
import { TERIM } from "./terim";
import {
  NOTIFICATION_DEFAULT_CHANNELS as KANAL_VARSAYILAN,
  NOTIFICATION_DEFAULT_RETENTION as SAKLAMA,
  NOTIFICATION_DESKTOP_CHANNELS as KANAL_MASAUSTU,
  type NotificationCatalogEntry,
} from "./notification-catalog.types";

const ORTAK = {
  sinif: "BILDIRIM", altTur: "OLAY", varsayilan: "HERKES", kilit: "YOK",
  kanallar: KANAL_MASAUSTU, varsayilanKanallar: KANAL_VARSAYILAN, saklama: SAKLAMA,
} as const;
const KOSUL = { ...ORTAK, altTur: "KOSUL", pencereSn: 0 } as const;

/** Makine duruşları raporu: dokumalı ve dokumasız (genel duruş rejimi) kurulumda aynı ekran. */
const MAKINE_DURUS = {
  izinler: [["report:production"]], modul: "productionEnabled",
  panelEkran: "reports/production", panelYol: "/reports/production/makine-duruslari",
} as const;
const URETIM_RAPOR = { izinler: [["report:production"]], modul: "productionEnabled", panelEkran: "reports/production" } as const;
const LEVENT = {
  izinler: [["warpbeam:read"]], modul: "devereEnabled",
  panelEkran: "operations/warp-beams", panelYol: "/operations/warp-beams?search={leventNo}",
} as const;

export const URETIM_NOTIFICATION_ENTRIES = {
  // ── Bakım (arıza = `BREAKDOWN_STOP_REASON_CODES`) ─────────────────────────
  "bakim.ariza": {
    ...ORTAK, ...MAKINE_DURUS, kod: "bakim.ariza", ad: "Makine arızası", grup: "Bakım", onemli: true,
    tekilKalibi: "{makineId}", pencereSn: 600,
    baslik: "Arıza: {makineAd}",
    govde: "{makineAd} arızalandı: {sebep} · {kullanici}",
    payloadAlanlari: ["makineId", "makineAd", "sebep", "kullanici"],
    tahminiHaftalik: 3,
  },
  "bakim.tamamlandi": {
    ...ORTAK, ...MAKINE_DURUS, kod: "bakim.tamamlandi", ad: "Arıza giderildi", grup: "Bakım",
    tekilKalibi: "{makineId}", pencereSn: 600,
    baslik: "Arıza giderildi: {makineAd}",
    govde: "{makineAd} yeniden çalışıyor ({sebep}, {sureDk} dk durdu) · {kullanici}",
    payloadAlanlari: ["makineId", "makineAd", "sebep", "sureDk", "kullanici"],
    tahminiHaftalik: 3,
  },
  "bakim.uzun-durus": {
    ...KOSUL, ...MAKINE_DURUS, kod: "bakim.uzun-durus", ad: "Arıza uzun sürüyor", grup: "Bakım", onemli: true,
    tekilKalibi: "{durusId}",
    baslik: "Arıza uzun sürüyor: {makineAd}",
    govde: "{makineAd} {baslangic} saatinden beri arızada: {sebep}",
    cozuldu: "{makineAd} arızası kapandı",
    paramSemasi: z.object({ saat: z.number().min(0.5).max(72).default(2) }).strict(),
    payloadAlanlari: ["durusId", "makineAd", "baslangic", "sebep"],
    tahminiHaftalik: 1,
  },

  // ── Üretim ────────────────────────────────────────────────────────────────
  "uretim.istasyon-durdu": {
    ...KOSUL, ...MAKINE_DURUS, kod: "uretim.istasyon-durdu", ad: "Makine duruyor", grup: "Üretim", onemli: true,
    tekilKalibi: "{durusId}",
    baslik: "Makine duruyor: {makineAd}",
    govde: "{makineAd} ({istasyonAd}) {baslangic} saatinden beri duruyor · {sebep}",
    cozuldu: "{makineAd} yeniden çalışıyor",
    paramSemasi: z.object({ dakika: z.number().int().min(5).max(1440).default(30) }).strict(),
    payloadAlanlari: ["durusId", "makineAd", "istasyonAd", "baslangic", "sebep"],
    tahminiHaftalik: 10,
  },
  "uretim.top-uretildi-ozet": {
    ...ORTAK, ...URETIM_RAPOR, kod: "uretim.top-uretildi-ozet", ad: "Saatlik üretim özeti", grup: "Üretim", ozet: "SAATLIK",
    tekilKalibi: "{pencere}", pencereSn: 0, panelYol: "/reports/production/uretim-akisi",
    baslik: "Saatlik üretim · {saat}",
    govde: "{top} top · {metre} m kumaş bitti",
    payloadAlanlari: ["pencere", "saat", "top", "metre"],
    tahminiHaftalik: 80,
  },
  "uretim.gun-sonu-ozet": {
    ...ORTAK, ...URETIM_RAPOR, kod: "uretim.gun-sonu-ozet", ad: "Gün sonu üretim özeti", grup: "Üretim", ozet: "GUN_SONU",
    tekilKalibi: "{gun}", pencereSn: 0, panelYol: "/reports/production/uretim-akisi",
    baslik: "Gün sonu üretim · {gun}",
    get govde() { return `{top} top · {metre} m kumaş bitti · {biten} ${TERIM.terbiyeIsEmri.tekilKucuk} tamamlandı`; },
    payloadAlanlari: ["gun", "top", "metre", "biten"],
    tahminiHaftalik: 7,
  },

  // ── Kurşun ────────────────────────────────────────────────────────────────
  "kursun.gramaj-sapmasi": {
    ...ORTAK, ...URETIM_RAPOR, kod: "kursun.gramaj-sapmasi", ad: "Kurşun gramajı hedeften saptı", grup: "Üretim", onemli: true,
    tekilKalibi: "{isEmriId}", pencereSn: 600, panelYol: "/reports/production/kursun-gramaj",
    baslik: "Gramaj sapması: {isEmriNo}",
    govde: "{topNo} topuna {gramaj} basıldı, hedef {hedef} · {kullanici}",
    payloadAlanlari: ["isEmriId", "isEmriNo", "topNo", "gramaj", "hedef", "kullanici"],
    tahminiHaftalik: 2,
  },
  "kursun.gunluk-ozet": {
    ...ORTAK, ...URETIM_RAPOR, kod: "kursun.gunluk-ozet", ad: "Günlük kurşun özeti", grup: "Üretim", ozet: "GUN_SONU",
    tekilKalibi: "{gun}", pencereSn: 0, panelYol: "/reports/production/kursun-gramaj",
    baslik: "Günlük kurşun özeti · {gun}",
    govde: "{top} topa kurşun basıldı ({metre} m) · hedeften sapan {sapan}",
    payloadAlanlari: ["gun", "top", "metre", "sapan"],
    tahminiHaftalik: 7,
  },

  // ── Tambur ────────────────────────────────────────────────────────────────
  "tambur.yeniden-islem": {
    ...ORTAK, kod: "tambur.yeniden-islem", ad: "Top yeniden işleme gönderildi", grup: "Üretim", onemli: true,
    izinler: [["workorder:read"]], modul: "productionEnabled",
    tekilKalibi: "{isEmriId}", pencereSn: 600,
    panelEkran: "operations/work-orders", panelYol: "/operations/work-orders/{isEmriId}",
    baslik: "Yeniden işlem: {isEmriNo}",
    govde: "{kullanici} {topNo} topunu Tambur'dan {istasyonAd} adımına geri gönderdi ({sebep})",
    payloadAlanlari: ["isEmriId", "isEmriNo", "topNo", "istasyonAd", "sebep", "kullanici"],
    tahminiHaftalik: 2,
  },

  // ── Kalite ────────────────────────────────────────────────────────────────
  "kalite.gunluk-ozet": {
    ...ORTAK, kod: "kalite.gunluk-ozet", ad: "Günlük kalite özeti", grup: "Kalite", ozet: "GUN_SONU",
    izinler: [["report:quality"]], modul: "productionEnabled",
    tekilKalibi: "{gun}", pencereSn: 0,
    panelEkran: "reports/quality", panelYol: "/reports/quality/kalite",
    baslik: "Günlük kalite özeti · {gun}",
    govde: "{metre} m kumaşın %{birinciOran}'i 1. kalite · 2. kalite {ikinciMetre} m · fire {fireMetre} m",
    payloadAlanlari: ["gun", "metre", "birinciOran", "ikinciMetre", "fireMetre"],
    tahminiHaftalik: 7,
  },

  // ── Dokuma ────────────────────────────────────────────────────────────────
  "dokuma.levent-takildi": {
    ...ORTAK, ...LEVENT, kod: "dokuma.levent-takildi", ad: "Levent bağlandı", grup: "Dokuma",
    tekilKalibi: "{leventId}", pencereSn: 600,
    baslik: "Levent bağlandı: {leventNo}",
    govde: "{leventNo} leventi {tezgahAd} tezgahına bağlandı · {kullanici}",
    payloadAlanlari: ["leventId", "leventNo", "tezgahAd", "kullanici"],
    tahminiHaftalik: 10,
  },
  "dokuma.levent-bitti": {
    ...ORTAK, ...LEVENT, kod: "dokuma.levent-bitti", ad: "Levent bitti", grup: "Dokuma",
    tekilKalibi: "{leventId}", pencereSn: 600,
    baslik: "Levent bitti: {leventNo}",
    govde: "{leventNo} leventi {tezgahAd} tezgahında bitti · {kullanici}",
    payloadAlanlari: ["leventId", "leventNo", "tezgahAd", "kullanici"],
    tahminiHaftalik: 10,
  },
  "dokuma.desen-degisti": {
    ...ORTAK, kod: "dokuma.desen-degisti", ad: "Tezgahta desen/renk değişti", grup: "Dokuma",
    izinler: [["weavingorder:read"]], modul: "dokumaEnabled",
    tekilKalibi: "{tezgahId}", pencereSn: 600,
    panelEkran: "operations/loom-load", panelYol: "/operations/loom-load",
    baslik: "Desen değişti: {tezgahAd}",
    govde: "{tezgahAd}: {eskiKumas} → {yeniKumas} · {kullanici}",
    payloadAlanlari: ["tezgahId", "tezgahAd", "eskiKumas", "yeniKumas", "kullanici"],
    tahminiHaftalik: 5,
  },
  "dokuma.tezgah-durdu": {
    ...KOSUL, kod: "dokuma.tezgah-durdu", ad: "Tezgah duruyor", grup: "Dokuma", onemli: true,
    izinler: [["loom:manual-entry"], ["loom:classify"]], modul: "dokumaEnabled",
    tekilKalibi: "{durusId}",
    panelEkran: "operations/machine-stops", panelYol: "/operations/machine-stops",
    baslik: "Tezgah duruyor: {tezgahAd}",
    govde: "{tezgahAd} {baslangic} saatinden beri duruyor · {sebep}",
    cozuldu: "{tezgahAd} yeniden çalışıyor",
    paramSemasi: z.object({ dakika: z.number().int().min(5).max(1440).default(30) }).strict(),
    payloadAlanlari: ["durusId", "tezgahAd", "baslangic", "sebep"],
    tahminiHaftalik: 15,
  },
  "dokuma.vardiya-ozet": {
    ...ORTAK, kod: "dokuma.vardiya-ozet", ad: "Vardiya sonu dokuma özeti", grup: "Dokuma", ozet: "VARDIYA",
    izinler: [["report:production"]], modul: "dokumaEnabled",
    tekilKalibi: "{vardiyaId}", pencereSn: 0,
    panelEkran: "reports/dokuma", panelYol: "/reports/dokuma/duruslar",
    baslik: "Vardiya sonu dokuma · {vardiyaAd}",
    govde: "{doff} top indi ({metre} m) · {durus} duruş, {durusDk} dk",
    payloadAlanlari: ["vardiyaId", "vardiyaAd", "doff", "metre", "durus", "durusDk"],
    tahminiHaftalik: 14,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;
