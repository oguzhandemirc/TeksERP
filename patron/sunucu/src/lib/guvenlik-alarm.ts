// GÜVENLİK ALARMI ÇEKİRDEĞİ — satıcı ve patron sunucusunda BAYT-EŞİT (bekçi `test_guvenlik_bildirimi` aynayı ölçer);
// saf mantık, içe aktarım YOK. Olay sınıf başına sayılır; dakikalık eşik aşılınca İLK ileti hemen, aynı sınıfın
// birleştirme penceresi boyunca gelenler pencere sonunda TEK iletide sayaçla; günde bir özet. Teslim çağıranın işidir.

export type AlarmTuru = "ILK" | "BIRLESIK";

export interface AlarmIletisi {
  readonly sinif: string;
  readonly tur: AlarmTuru;
  /** İLK: eşiği aşan dakikadaki olay sayısı · BIRLESIK: pencerede eklenen olay sayısı. */
  readonly adet: number;
  readonly pencereBasi: number;
  /** Olayın kısa kodu (sır ve kişisel veri taşımaz); yoksa null. */
  readonly ornek: string | null;
}

export interface GunlukOzet {
  /** UTC günü (YYYY-MM-DD) — tekillik anahtarı. */
  readonly gun: string;
  readonly sayac: Readonly<Record<string, number>>;
  /** Sayımın başladığı an (süreç açılışı 24 saatten yeniyse özet bunu söyler). */
  readonly sayimBasi: number;
}

export interface AlarmAyari {
  /** Sınıf → dakikada eşik (bu sayıya ulaşınca alarm); beyansız sınıf 1. */
  readonly esikDk: Readonly<Record<string, number>>;
  readonly pencereMs: number;
}

const DAKIKA_MS = 60_000;
const SAAT_MS = 3_600_000;

export class GuvenlikAlarmi {
  private readonly dakika = new Map<string, { bas: number; adet: number }>();
  private readonly pencere = new Map<string, { bas: number; ek: number; ornek: string | null }>();
  private readonly saatlik = new Map<number, Map<string, number>>();
  private sonOzetGunu: string | null = null;

  constructor(
    private readonly ayar: AlarmAyari,
    private readonly sayimBasi: number,
  ) {}

  /** Olayı sayar; eşik aşıldıysa ve sınıfın açık penceresi yoksa İLK iletiyi döner, aksi hâlde null. */
  kaydet(sinif: string, simdi: number, ornek: string | null = null): AlarmIletisi | null {
    const saat = Math.floor(simdi / SAAT_MS);
    const kova = this.saatlik.get(saat) ?? new Map<string, number>();
    kova.set(sinif, (kova.get(sinif) ?? 0) + 1);
    this.saatlik.set(saat, kova);
    const onceki = this.dakika.get(sinif);
    const dk = !onceki || simdi - onceki.bas >= DAKIKA_MS ? { bas: simdi, adet: 0 } : onceki;
    dk.adet++;
    this.dakika.set(sinif, dk);
    const acik = this.pencere.get(sinif);
    if (acik) {
      acik.ek++;
      acik.ornek = ornek ?? acik.ornek;
      return null;
    }
    if (dk.adet < (this.ayar.esikDk[sinif] ?? 1)) return null;
    this.pencere.set(sinif, { bas: simdi, ek: 0, ornek });
    return { sinif, tur: "ILK", adet: dk.adet, pencereBasi: simdi, ornek };
  }

  /**
   * Süresi dolan pencereler: eklenen olay varsa TEK BIRLESIK ileti ve pencere yeniden açılır (sel sürdükçe pencere
   * başına bir ileti); boş geçen pencere kapanır. 24 saatten eski saat kovaları düşer.
   */
  tick(simdi: number): AlarmIletisi[] {
    const out: AlarmIletisi[] = [];
    for (const [sinif, p] of this.pencere) {
      if (simdi - p.bas < this.ayar.pencereMs) continue;
      if (p.ek === 0) {
        this.pencere.delete(sinif);
        continue;
      }
      out.push({ sinif, tur: "BIRLESIK", adet: p.ek, pencereBasi: p.bas, ornek: p.ornek });
      this.pencere.set(sinif, { bas: simdi, ek: 0, ornek: null });
    }
    const esik = Math.floor(simdi / SAAT_MS) - 24;
    for (const saat of this.saatlik.keys()) if (saat <= esik) this.saatlik.delete(saat);
    return out;
  }

  /** Son 24 saatte sınıf başına olay sayısı (eşik altı olaylar dahil). */
  son24Saat(simdi: number): Record<string, number> {
    const esik = Math.floor(simdi / SAAT_MS) - 24;
    const out: Record<string, number> = {};
    for (const [saat, kova] of this.saatlik) {
      if (saat <= esik) continue;
      for (const [sinif, n] of kova) out[sinif] = (out[sinif] ?? 0) + n;
    }
    return out;
  }

  /** Yeni UTC gününün ilk çağrısında özet, aynı gün içinde null. */
  gunlukOzet(simdi: number): GunlukOzet | null {
    const gun = new Date(simdi).toISOString().slice(0, 10);
    if (gun === this.sonOzetGunu) return null;
    this.sonOzetGunu = gun;
    return { gun, sayac: this.son24Saat(simdi), sayimBasi: this.sayimBasi };
  }
}
