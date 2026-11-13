// Yazma katmanı (V4b): ekranlar kip bilmez, `Yazici` ile yazar. Bulut: yalnız yaratma, gelen kutusu MESAJI olarak
// (`api.inboxCreate`, gövde bayt aynı); düzenleme/iptal/pasif bulutta yok (ağsız 404). ERP: fabrikanın panelin
// kullandığı uçları. Tel gövdesi → ERP gövdesi eşlemesi fabrikanın gelen kutusu eşlemesiyle (`inbox-wire.ts`) aynıdır.
import { ApiError, type ApiClient } from "./client";
import type { Api } from "./endpoints";
import { kipteYok } from "./baglanti";
import type { CustomerMessageBody, OrderMessageBody } from "./wire";
import { fmtCalendarDay } from "../lib/factory-time";

export type YazmaSonucu = { readonly tur: "gelen-kutusu"; readonly mesajId: string } | { readonly tur: "kayit"; readonly id: string };

/** Fabrikanın bayat veri koruması (V4a): `expectedUpdatedAt` tutmadı. */
export const STALE_RECORD = "STALE_RECORD";

/** ERP cari kartı — düzenleme formunun okuduğu alanlar; `surum` = `updatedAt` (geri yollanır). */
export interface CariKaydi {
  readonly id: string;
  readonly surum: string;
  readonly kod: string;
  readonly ad: string;
  readonly musteri: boolean;
  readonly tedarikci: boolean;
  /** Fason rolü telefonda değişmez; yalnız "en az bir rol" denetimi için. */
  readonly fason: boolean;
  readonly il: string;
  readonly vergiNo: string;
  readonly telefon: string;
  readonly eposta: string;
  readonly aktif: boolean;
}

/** ERP sipariş başlığı; `surum` = `contentUpdatedAt` (V4a; yoksa null → düzenleme kapalı). */
export interface SiparisKaydi {
  readonly id: string;
  readonly surum: string | null;
  readonly no: string;
  readonly durum: string;
  readonly cariKartId: string;
  readonly cariAdi: string;
  readonly doviz: string;
  /** "GG.AA.YYYY" (takvim günü) ya da "". */
  readonly termin: string;
  readonly kalemSayisi: number;
}

export interface IptalOnizleme {
  readonly siparisNo: string;
  readonly isEmirleri: readonly { readonly id: string; readonly no: string; readonly durum: string; readonly uretilenTop: number }[];
  readonly sevkiyatlar: readonly { readonly no: string; readonly durum: string }[];
  readonly iptalEdilebilir: boolean;
  /** Fabrikanın önizleme belirteci (V4c); eski sunucuda null → iptal gövdesine konmaz. */
  readonly belirtec: string | null;
}

/** Önizleme belirteci tutmadı: sipariş kullanıcı bakarken değişti, hiçbir şey uygulanmadı. */
export const CANCEL_PREVIEW_STALE = "CANCEL_PREVIEW_STALE";

/** ERP renk kaydı (V5c); `surum` = `updatedAt`. Kod fabrikada doğar. */
export interface RenkKaydi {
  readonly id: string;
  readonly surum: string;
  readonly kod: string;
  readonly ad: string;
  /** "#RRGGBB" ya da "". */
  readonly hex: string;
  readonly aktif: boolean;
}

export interface RenkGovdesi {
  readonly ad: string;
  readonly hex?: string;
}

export interface Yazici {
  /** Yaratma nereye gider: gelen kutusu MESAJI (fabrika sonra işler) ya da doğrudan fabrika kaydı. */
  readonly kanal: "gelen-kutusu" | "dogrudan";
  /** Sipariş formunda açıklama alanı var mı (ERP siparişinde kolon yok). */
  readonly siparisNotu: boolean;
  cariEkle(islemId: string, g: CustomerMessageBody): Promise<YazmaSonucu>;
  siparisEkle(islemId: string, g: OrderMessageBody): Promise<YazmaSonucu>;
  cariOku(id: string): Promise<CariKaydi>;
  cariGuncelle(id: string, surum: string, patch: Readonly<Record<string, unknown>>): Promise<CariKaydi>;
  cariPasif(id: string): Promise<void>;
  siparisOku(id: string): Promise<SiparisKaydi>;
  siparisGuncelle(id: string, surum: string, patch: Readonly<Record<string, unknown>>): Promise<SiparisKaydi>;
  siparisIptalOnizleme(id: string): Promise<IptalOnizleme>;
  /** `belirtec`: kullanıcının onayladığı önizlemenin belirteci (yoksa gönderilmez). */
  siparisIptal(id: string, belirtec?: string | null): Promise<void>;
  renkEkle(islemId: string, g: RenkGovdesi): Promise<YazmaSonucu>;
  renkOku(id: string): Promise<RenkKaydi>;
  renkGuncelle(id: string, surum: string, patch: Readonly<Record<string, unknown>>): Promise<RenkKaydi>;
  renkPasif(id: string): Promise<void>;
}

const seg = (v: string) => encodeURIComponent(v);
const yok = () => Promise.reject(kipteYok("KIP_DESTEKLEMIYOR"));

/** Bulut: yaratma gelen kutusundan (bugünkü çağrı, bayt aynı); diğer işlemler yok. */
export function createBulutYazici(api: Api): Yazici {
  return {
    kanal: "gelen-kutusu",
    siparisNotu: true,
    cariEkle: async (id, g) => ({ tur: "gelen-kutusu", mesajId: (await api.inboxCreate(id, "CARI", g)).mesajId }),
    siparisEkle: async (id, g) => ({ tur: "gelen-kutusu", mesajId: (await api.inboxCreate(id, "SIPARIS", g)).mesajId }),
    cariOku: yok,
    cariGuncelle: yok,
    cariPasif: yok,
    siparisOku: yok,
    siparisGuncelle: yok,
    siparisIptalOnizleme: yok,
    siparisIptal: yok,
    renkEkle: yok,
    renkOku: yok,
    renkGuncelle: yok,
    renkPasif: yok,
  };
}

/** Takvim günü "YYYY-MM-DD" → panelle aynı an (UTC gece yarısı; `calendarDayZone` takvim günü sayar). */
export const terminAni = (isoGun: string): string => `${isoGun}T00:00:00.000Z`;

const DECIMAL = (v: string | undefined) => (v === undefined ? undefined : Number(v));
const tanimli = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Sipariş tel gövdesi → `POST /api/orders` gövdesi (`clientToken` = deneme kimliği). `aciklama` ERP'de yok. */
export function siparisGovdesi(g: OrderMessageBody, clientToken: string): Record<string, unknown> {
  return tanimli({
    customerId: g.cariKartId,
    branchId: g.subeId,
    currency: g.doviz,
    deadline: g.termin ? terminAni(g.termin) : undefined,
    lines: g.kalemler.map((k) =>
      tanimli({ itemId: k.urunId, colorId: k.renkId, quantity: DECIMAL(k.miktar), unit: k.birim, unitPrice: DECIMAL(k.birimFiyat), width: DECIMAL(k.en), customerItemName: k.musteriUrunAdi, customerColorName: k.musteriRenkAdi }),
    ),
    clientToken,
  });
}

/**
 * Cari tel gövdesi → `POST /api/customers` gövdesi (kod fabrikada doğar; finans alt nesnesi gönderilmez).
 * `clientToken` = deneme kimliği: yeni fabrika aynı token'a ilk kartı döner, eski fabrika gövde süzgecinde düşürür.
 */
export function cariGovdesi(g: CustomerMessageBody, clientToken?: string): Record<string, unknown> {
  return tanimli({
    name: g.ad,
    isCustomerRole: g.roller.musteri,
    isSupplierRole: g.roller.tedarikci,
    city: g.il,
    district: g.ilce,
    country: g.ulke,
    taxNumber: g.vergiNo,
    address: g.adres,
    contactName: g.yetkili,
    contactPhone: g.telefon,
    email: g.eposta,
    clientToken,
  });
}

type Ham = Readonly<Record<string, unknown>>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const tarih = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function beklenmeyen(): ApiError {
  return new ApiError(502, "SUNUCU_HATASI", "Sunucudan beklenmeyen yanıt");
}

export function cariKaydi(h: Ham | null | undefined): CariKaydi {
  const surum = tarih(h?.updatedAt);
  if (!h || typeof h.id !== "string" || !surum) throw beklenmeyen();
  return {
    id: h.id, surum, kod: s(h.code), ad: s(h.name),
    musteri: h.isCustomerRole === true, tedarikci: h.isSupplierRole === true, fason: h.isSubcontractorRole === true,
    il: s(h.city), vergiNo: s(h.taxNumber), telefon: s(h.contactPhone), eposta: s(h.email), aktif: h.isActive !== false,
  };
}

export function renkKaydi(h: Ham | null | undefined): RenkKaydi {
  const surum = tarih(h?.updatedAt);
  if (!h || typeof h.id !== "string" || !surum) throw beklenmeyen();
  return { id: h.id, surum, kod: s(h.code), ad: s(h.name), hex: s(h.hex), aktif: h.isActive !== false };
}

export function siparisKaydi(h: Ham | null | undefined): SiparisKaydi {
  if (!h || typeof h.id !== "string") throw beklenmeyen();
  const cari = (h.customer ?? {}) as Ham;
  const lines = Array.isArray(h.lines) ? (h.lines as Ham[]) : [];
  return {
    id: h.id,
    // Yalnız V4a sürümü kabul: `updatedAt` kalem yazımını kaçırır, yanlış güven verir.
    surum: tarih(h.contentUpdatedAt),
    no: s(h.orderNumber), durum: s(h.status), cariKartId: s(h.customerId), cariAdi: s(cari.name), doviz: s(h.currency) || "TRY",
    termin: h.deadline ? fmtCalendarDay(h.deadline as string, "") : "",
    kalemSayisi: lines.filter((l) => l.cancelledAt == null).length,
  };
}

export function iptalOnizleme(h: Ham | null | undefined): IptalOnizleme {
  if (!h || !Array.isArray(h.affectedWorkOrders) || !Array.isArray(h.activeShipments)) throw beklenmeyen();
  return {
    siparisNo: s(h.orderNumber),
    isEmirleri: (h.affectedWorkOrders as Ham[]).map((w) => ({ id: s(w.id), no: s(w.workOrderNumber), durum: s(w.status), uretilenTop: typeof w.producedRollCount === "number" ? w.producedRollCount : 0 })),
    sevkiyatlar: (h.activeShipments as Ham[]).map((x) => ({ no: s(x.shipmentNo), durum: s(x.status) })),
    iptalEdilebilir: h.canCancel === true,
    belirtec: typeof h.previewToken === "string" && h.previewToken !== "" ? h.previewToken : null,
  };
}

/** Telefonda iptal yalnız İE ve aktif sevkiyat taşımayan siparişte: İE eylemi panelde kayıt başına seçilir. */
export type IptalKarari = "SEVKIYAT_VAR" | "URETIMDE" | "SERBEST";
export function iptalKarari(o: IptalOnizleme): IptalKarari {
  if (!o.iptalEdilebilir || o.sevkiyatlar.length > 0) return "SEVKIYAT_VAR";
  if (o.isEmirleri.length > 0) return "URETIMDE";
  return "SERBEST";
}

export function createErpYazici(c: ApiClient): Yazici {
  const onizle = async (id: string) => iptalOnizleme(await c.get<Ham>(`/orders/${seg(id)}/cancel-preview`));
  return {
    kanal: "dogrudan",
    siparisNotu: false,
    cariEkle: async (id, g) => {
      const r = await c.post<Ham>("/customers", cariGovdesi(g, id));
      if (typeof r?.id !== "string") throw beklenmeyen();
      return { tur: "kayit", id: r.id };
    },
    siparisEkle: async (id, g) => {
      const r = await c.post<Ham>("/orders", siparisGovdesi(g, id));
      if (typeof r?.id !== "string") throw beklenmeyen();
      return { tur: "kayit", id: r.id };
    },
    cariOku: async (id) => cariKaydi(await c.get<Ham>(`/customers/${seg(id)}`)),
    cariGuncelle: async (id, surum, patch) => cariKaydi(await c.patch<Ham>(`/customers/${seg(id)}`, { ...patch, expectedUpdatedAt: surum })),
    cariPasif: async (id) => {
      await c.del<unknown>(`/customers/${seg(id)}`);
    },
    siparisOku: async (id) => siparisKaydi(await c.get<Ham>(`/orders/${seg(id)}`)),
    siparisGuncelle: async (id, surum, patch) => siparisKaydi(await c.patch<Ham>(`/orders/${seg(id)}`, { ...patch, expectedUpdatedAt: surum })),
    siparisIptalOnizleme: onizle,
    siparisIptal: async (id, belirtec) => {
      // Uygulama anında önizleme YENİDEN okunur: arada İE bağlandıysa sunucu ona varsayılan eylem uygulardı → dur.
      const karar = iptalKarari(await onizle(id));
      if (karar !== "SERBEST") throw new ApiError(409, karar === "URETIMDE" ? "SIPARIS_URETIMDE" : "AKTIF_SEVKIYAT", IPTAL_ILETISI[karar]);
      // Belirteç kullanıcının GÖRDÜĞÜ önizlemeden: arada değiştiyse fabrika 409 CANCEL_PREVIEW_STALE verir, uygulamaz.
      await c.post<unknown>(`/orders/${seg(id)}/cancel`, belirtec ? { workOrderActions: [], expectedPreviewToken: belirtec } : { workOrderActions: [] });
    },
    // Renk doğuşunda fabrika `clientToken` almaz (kolon yok): belirsiz tekrarın koruması ad tekilliğidir (409).
    renkEkle: async (_id, g) => {
      const r = await c.post<Ham>("/colors", tanimli({ name: g.ad, hex: g.hex }));
      if (typeof r?.id !== "string") throw beklenmeyen();
      return { tur: "kayit", id: r.id };
    },
    renkOku: async (id) => renkKaydi(await c.get<Ham>(`/colors/${seg(id)}`)),
    renkGuncelle: async (id, surum, patch) => renkKaydi(await c.patch<Ham>(`/colors/${seg(id)}`, { ...patch, expectedUpdatedAt: surum })),
    renkPasif: async (id) => {
      await c.del<unknown>(`/colors/${seg(id)}`);
    },
  };
}

export const IPTAL_ILETISI: Readonly<Record<Exclude<IptalKarari, "SERBEST">, string>> = {
  SEVKIYAT_VAR: "Siparişin aktif sevkiyatı var; iptal edilemez",
  URETIMDE: "Bu sipariş üretimde; panelden iptal edin",
};
