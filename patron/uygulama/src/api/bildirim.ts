// Gelen bildirim katmanı (ERP kipi): fabrikanın kişisel gelen kutusu (`/api/bildirim/*`, verifyToken; satır kapsamı
// sunucuda `userId` + görme süzgeci). Ekran kip bilmez; `yetenek().bildirimKutusu` açıksa `Bildirimci` ile çalışır.
// Bulutun bildirim akışı (`/bildirim/ayarlar`, `/bildirimler` geçmişi) `Api` üzerinde AYNEN kalır; bulut `Bildirimci`si ağa gitmez.
import { kipteYok } from "./baglanti";
import type { ApiClient } from "./client";

export const ERP_BILDIRIM_ENDPOINTS = {
  ozet: ["get", "/bildirim/ozet"],
  liste: ["get", "/bildirim"],
  okundu: ["post", "/bildirim/:id/okundu"],
  tumunuOkundu: ["post", "/bildirim/tumunu-okundu"],
  // Push köprüsü P4 (`/auth/me` `patronPush` açıkken): telefon belirteci + tür başına PATRON_PUSH tercihi.
  cihazKaydet: ["post", "/bildirim/cihaz"],
  cihazBirak: ["delete", "/bildirim/cihaz"],
  katalog: ["get", "/bildirim/katalog"],
  tercihler: ["get", "/bildirim/tercihler"],
  tercihYaz: ["put", "/bildirim/tercihler"],
  // Tercih profilleri (fabrika 2026-11-15): eski fabrika 404 → ekran üç hazır düğmeye geri düşer.
  profiller: ["get", "/bildirim/tercihler/profiller"],
  profilKaydet: ["post", "/bildirim/tercihler/profiller"],
  profilUygula: ["post", "/bildirim/tercihler/profil-uygula"],
  profilGuncelle: ["patch", "/bildirim/tercihler/profiller/:id"],
  profilSil: ["delete", "/bildirim/tercihler/profiller/:id"],
} as const;

/** Telefon bildirimi kanalı (fabrika `NotificationKanal`). */
export const PATRON_PUSH_KANAL = "PATRON_PUSH";

/** `GET /bildirim/tercihler` — yalnız okunan alanlar. `hucreler` görünen türler; `satirlar` kişinin kendi sapma satırları. */
export interface TercihHucresi {
  readonly kind: string;
  readonly kanallar: readonly { readonly kanal: string; readonly durum: "ACIK" | "KAPALI" | "GIZLI"; readonly kilit: boolean }[];
}
export interface TercihSatiri {
  readonly tur: string;
  readonly kanal: string;
  readonly acik: boolean;
  readonly kapsam?: unknown;
}
export interface Tercihler {
  readonly hucreler: readonly TercihHucresi[];
  readonly satirlar: readonly TercihSatiri[];
}
export interface KatalogTuru {
  readonly kod: string;
  readonly ad: string;
  /** Departman (fabrika `NotificationGrup`); grup başına aç/kapat bundan. */
  readonly grup?: string;
  readonly sinif?: string;
  readonly varsayilanKanallar?: readonly string[];
  /** Katalog "önemli" işareti (fabrika 2.16.1+); eski fabrikada yok → yalnız ALARM önemli sayılır. */
  readonly onemli?: boolean;
}

/** Hazır profil: tür kümesi fabrikada katalogdan türer (kişinin görebildikleriyle kesişik). */
export interface HazirProfil {
  readonly kod: string;
  readonly ad: string;
  readonly aciklama: string;
  readonly acik: readonly string[];
}
/** Kişisel kayıtlı profil (kayıtlı seçimin fotoğrafı). */
export interface KisiselProfil {
  readonly id: string;
  readonly ad: string;
  readonly acik: readonly string[];
  readonly kapali: readonly string[];
}
/** `GET /tercihler/profiller?kanal=PATRON_PUSH`; `etkin` kayıtlı seçimle eşleşenler ("hazir:KOD" · "kisisel:<id>"), boş = Özel. */
export interface ProfilGorunumu {
  readonly hazir: readonly HazirProfil[];
  readonly kisisel: readonly KisiselProfil[];
  readonly etkin: readonly string[];
}
export const hazirAnahtar = (kod: string) => `hazir:${kod}`;
export const kisiselAnahtar = (id: string) => `kisisel:${id}`;

/** Etkin profil adı (birden çoksa ilki; hazır önce gelir) ya da "Özel". */
export function etkinProfilAdi(g: ProfilGorunumu): string {
  const ad = new Map<string, string>([...g.hazir.map((p) => [hazirAnahtar(p.kod), p.ad] as const), ...g.kisisel.map((p) => [kisiselAnahtar(p.id), p.ad] as const)]);
  for (const e of g.etkin) {
    const a = ad.get(e);
    if (a) return a;
  }
  return "Özel";
}

/** Telefon push cihazı + tercih (ERP). Yalnız `yetenek().patronPush` açıkken çağrılır. */
export interface PushCihazci {
  /** `sesBildirim`/`sesAlarm` (S0): eski fabrika alanı tanımaz (katı şema) → yalnız varsayılandan sapınca yollanır (`erp-push.ts`). */
  kaydet(b: { belirtec: string; platform: "android" | "ios"; cihazAdi?: string; sesBildirim?: string; sesAlarm?: string }): Promise<unknown>;
  birak(belirtec: string): Promise<unknown>;
  katalog(): Promise<{ turler: readonly KatalogTuru[] }>;
  tercihler(): Promise<Tercihler>;
  tercihYaz(tercihler: readonly TercihSatiri[]): Promise<Tercihler>;
  /** Profil uçlarının hepsi telefon kanalında (PATRON_PUSH) çalışır. */
  profiller(): Promise<ProfilGorunumu>;
  /** Uygula hedef duruma yazar (idempotent, token yok); dönen tercihler + profiller. */
  profilUygula(p: { hazir: string } | { kisisel: string }): Promise<Tercihler & { profiller: ProfilGorunumu }>;
  /** Şimdiki KAYITLI seçimi adla kaydeder; `clientToken` mantıksal deneme başına (`attempt.ts`). */
  profilKaydet(ad: string, clientToken: string): Promise<{ profiller: ProfilGorunumu }>;
  profilGuncelle(id: string, b: { ad?: string; seciminiGuncelle?: boolean }): Promise<{ profiller: ProfilGorunumu }>;
  profilSil(id: string): Promise<ProfilGorunumu>;
}

export function createErpPushCihazci(c: ApiClient): PushCihazci {
  const E = ERP_BILDIRIM_ENDPOINTS;
  const K = PATRON_PUSH_KANAL;
  const yol = (id: string) => E.profilGuncelle[1].replace(":id", encodeURIComponent(id));
  return {
    kaydet: (b) => c.post(E.cihazKaydet[1], b),
    birak: (belirtec) => c.del(E.cihazBirak[1], { belirtec }),
    katalog: () => c.get(E.katalog[1]),
    tercihler: () => c.get(E.tercihler[1]),
    tercihYaz: (tercihler) => c.put(E.tercihYaz[1], { tercihler }),
    profiller: () => c.get(E.profiller[1], { kanal: K }),
    profilUygula: (p) => c.post(E.profilUygula[1], { kanal: K, ...p }),
    profilKaydet: (ad, clientToken) => c.post(E.profilKaydet[1], { ad, kanal: K, clientToken }),
    profilGuncelle: (id, b) => c.patch(yol(id), { ...b, kanal: K }),
    profilSil: (id) => c.del(`${yol(id)}?kanal=${K}`),
  };
}

/**
 * `PUT /bildirim/tercihler` TAM gövdedir (görünen türlerin bütün kendi satırları silinip yeniden yazılır). Yalnız
 * (tür, PATRON_PUSH) hücresi değişsin diye: görünen türün kendi kanallarındaki MEVCUT satırlar (kapsam dahil) aynen
 * geri yollanır, yalnız o hücrenin satırı eklenir/değişir. Görünmeyen türün satırı yollanmaz (sunucu onu silmez).
 */
export function pushTercihGovdesi(t: Tercihler, tur: string, acik: boolean): TercihSatiri[] {
  return pushTercihGovdesiToplu(t, new Map([[tur, acik]]));
}

/** Toplu (hazır düğme · grup): `degisen`deki her türün PATRON_PUSH hücresi yazılır, öteki satırlar AYNEN geri yollanır. */
export function pushTercihGovdesiToplu(t: Tercihler, degisen: ReadonlyMap<string, boolean>): TercihSatiri[] {
  const kanallar = new Map(t.hucreler.map((h) => [h.kind, new Set(h.kanallar.map((k) => k.kanal))]));
  const out: TercihSatiri[] = t.satirlar
    .filter((r) => kanallar.get(r.tur)?.has(r.kanal) && !(degisen.has(r.tur) && r.kanal === PATRON_PUSH_KANAL))
    .map((r) => (r.kapsam === undefined || r.kapsam === null ? { tur: r.tur, kanal: r.kanal, acik: r.acik } : { tur: r.tur, kanal: r.kanal, acik: r.acik, kapsam: r.kapsam }));
  for (const [tur, acik] of degisen) out.push({ tur, kanal: PATRON_PUSH_KANAL, acik });
  return out;
}

export type HazirSecim = "HEPSI" | "ONEMLI" | "HICBIRI";

/**
 * "Önemli" = alarm sınıfı ya da katalogda `onemli` işaretli tür (fabrikanın ONEMLI hazır profiliyle aynı yüklem).
 * Telefon varsayılan kanalı ÖLÇÜT DEĞİL: 2026-11-14'ten beri her tür PATRON_PUSH varsayılanlı, düğme "hepsini aç" oluyordu.
 */
export const onemliMi = (t: KatalogTuru | undefined): boolean => t?.sinif === "ALARM" || t?.onemli === true;

/** Hazır düğmenin hedefi: görünen her telefon hücresi için aç/kapat (yalnız değişenler döner). */
export function hazirSecimDegisimi(t: Tercihler, turler: readonly KatalogTuru[], secim: HazirSecim): Map<string, boolean> {
  const kat = new Map(turler.map((x) => [x.kod, x]));
  const out = new Map<string, boolean>();
  for (const h of pushHucreleri(t)) {
    const hedef = secim === "HEPSI" ? true : secim === "HICBIRI" ? false : onemliMi(kat.get(h.tur));
    if (hedef !== h.acik) out.set(h.tur, hedef);
  }
  return out;
}

/** Telefon hücreleri departmana göre (katalog sırası korunur; grupsuz tür "Diğer"). */
export function pushGruplari(t: Tercihler, turler: readonly KatalogTuru[]): { grup: string; hucreler: { tur: string; acik: boolean }[] }[] {
  const kat = new Map(turler.map((x) => [x.kod, x]));
  const gruplar = new Map<string, { tur: string; acik: boolean }[]>();
  for (const h of pushHucreleri(t)) {
    const g = kat.get(h.tur)?.grup ?? "Diğer";
    gruplar.set(g, [...(gruplar.get(g) ?? []), h]);
  }
  return [...gruplar].map(([grup, hucreler]) => ({ grup, hucreler }));
}

/** Tür → telefon bildirimi hücresi (yalnız kanalı taşıyan ve gizli olmayan türler). */
export function pushHucreleri(t: Tercihler): { tur: string; acik: boolean }[] {
  return t.hucreler.flatMap((h) => {
    const k = h.kanallar.find((x) => x.kanal === PATRON_PUSH_KANAL);
    return k && k.durum !== "GIZLI" ? [{ tur: h.kind, acik: k.durum === "ACIK" }] : [];
  });
}

/** `GET /bildirim/ozet`; bayrak kapalıyken yalnız `{enabled:false}`. */
export interface BildirimOzeti {
  readonly enabled: boolean;
  readonly okunmamis?: number;
  readonly epoch?: number;
  readonly rev?: number;
}

/** Liste satırı — yalnız uygulamanın okuduğu alanlar (metin sunucuda render edilmiş). */
export interface GelenBildirim {
  readonly id: string;
  readonly tur: string;
  readonly sinif: string;
  readonly baslik: string;
  readonly govde: string;
  readonly sayac: number;
  readonly sonAn: string;
  readonly okunduAn: string | null;
  readonly cozulduAn: string | null;
}

export interface BildirimSayfasi {
  readonly items: readonly GelenBildirim[];
  readonly nextCursor: string | null;
  readonly sayi: number;
}

export type BildirimSekmesi = "okunmamis" | "tumu";

export interface Bildirimci {
  ozet(): Promise<BildirimOzeti>;
  liste(p: { sekme: BildirimSekmesi; cursor?: string; limit?: number }): Promise<BildirimSayfasi>;
  okundu(id: string): Promise<{ degisti: boolean }>;
  tumunuOkundu(): Promise<{ ids: string[] }>;
}

export function createErpBildirimci(c: ApiClient): Bildirimci {
  return {
    ozet: () => c.get<BildirimOzeti>(ERP_BILDIRIM_ENDPOINTS.ozet[1]),
    liste: (p) => c.get<BildirimSayfasi>(ERP_BILDIRIM_ENDPOINTS.liste[1], { sekme: p.sekme, cursor: p.cursor, limit: p.limit }),
    okundu: (id) => c.post<{ degisti: boolean }>(`/bildirim/${encodeURIComponent(id)}/okundu`, {}),
    tumunuOkundu: () => c.post<{ ids: string[] }>(ERP_BILDIRIM_ENDPOINTS.tumunuOkundu[1], {}),
  };
}

/** Bulut: bu akış yok; her yöntem AĞA GİTMEDEN 404. */
export function createBulutBildirimci(): Bildirimci {
  const yok = () => Promise.reject(kipteYok("KIP_DESTEKLEMIYOR"));
  return { ozet: yok, liste: yok, okundu: yok, tumunuOkundu: yok };
}

/**
 * Fabrikada gelen kutusu açık mı (panelin kuralı: `/ozet` 404 ya da `enabled !== true` → yok). Ağ/sunucu hatası
 * da KAPALI sayılır (fail-closed); eski fabrika hata görmez, yalnız özellik gizlenir.
 */
export async function erpBildirimAcik(oku: () => Promise<BildirimOzeti>): Promise<boolean> {
  try {
    return (await oku()).enabled === true;
  } catch {
    return false;
  }
}
