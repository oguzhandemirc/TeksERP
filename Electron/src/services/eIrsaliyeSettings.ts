// Backend `services/e-irsaliye/e-irsaliye-settings.ts` aynası (E3-AYAR): gönderici resmi
// künyesi + e-İrsaliye yapılandırması. Varsayılanlar backend'le BİREBİR (okuma yükü
// eksik gelirse panel bugünkü davranışı — "Kapalı" — gösterir).

export interface CompanyLegalIdentity {
  kimlikTuru: "VKN" | "TCKN";
  kimlikNo: string;
  unvan: string;
  kisiAd: string;
  kisiSoyad: string;
  vergiDairesi: string;
  cadde: string;
  binaNo: string;
  ilce: string;
  il: string;
  postaKodu: string;
  ulke: string;
  mersisNo: string;
  ticaretSicilNo: string;
  telefon: string;
  eposta: string;
  web: string;
}

export const DEFAULT_COMPANY_LEGAL_IDENTITY: CompanyLegalIdentity = {
  kimlikTuru: "VKN",
  kimlikNo: "",
  unvan: "",
  kisiAd: "",
  kisiSoyad: "",
  vergiDairesi: "",
  cadde: "",
  binaNo: "",
  ilce: "",
  il: "",
  postaKodu: "",
  ulke: "TR",
  mersisNo: "",
  ticaretSicilNo: "",
  telefon: "",
  eposta: "",
  web: "",
};

/** Alan tavanları — backend `LEGAL_IDENTITY_LIMITS` ile aynı. */
export const LEGAL_IDENTITY_LIMITS: Readonly<Record<Exclude<keyof CompanyLegalIdentity, "kimlikTuru">, number>> = {
  kimlikNo: 11,
  unvan: 300,
  kisiAd: 100,
  kisiSoyad: 100,
  vergiDairesi: 100,
  cadde: 200,
  binaNo: 20,
  ilce: 100,
  il: 100,
  postaKodu: 10,
  ulke: 2,
  mersisNo: 16,
  ticaretSicilNo: 32,
  telefon: 40,
  eposta: 120,
  web: 120,
};

export type EIrsaliyeAdapter = "yok" | "disaAktar" | "simulasyon";

export interface EIrsaliyeConfig {
  adapter: EIrsaliyeAdapter;
  yururlukTarihi: string | null;
}

export const DEFAULT_EIRSALIYE_CONFIG: EIrsaliyeConfig = { adapter: "yok", yururlukTarihi: null };

/**
 * VKN/TCKN istemci ön doğrulaması — YALNIZ İPUCU; esas karar sunucunun hazırlık
 * kapısındadır (backend `tax-id.ts`). null = geçerli, metin = ipucu cümlesi.
 */
export function taxIdHint(kind: "VKN" | "TCKN", value: string): string | null {
  const v = value.replace(/\D/g, "");
  if (!v) return null;
  if (kind === "VKN") {
    if (v.length !== 10) return "VKN 10 hane olmalı.";
    const d = v.split("").map(Number);
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      const t = (d[i]! + 9 - i) % 10;
      sum += t === 9 ? 9 : (t * 2 ** (9 - i)) % 9;
    }
    return (10 - (sum % 10)) % 10 === d[9] ? null : "VKN'nin son hanesi tutmuyor — numarayı kontrol edin.";
  }
  if (!/^[1-9]\d{10}$/.test(v)) return "TCKN 11 hane olmalı ve 0 ile başlamamalı.";
  const d = v.split("").map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const ok = (((odd * 7 - even) % 10) + 10) % 10 === d[9] && d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
  return ok ? null : "TCKN'nin son haneleri tutmuyor — numarayı kontrol edin.";
}
