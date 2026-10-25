// =============================================================================
// ZİL İSTEMCİSİ — panel başına TEK akış (plan §3.9, §3.10)
// =============================================================================
// Düşüş merdiveni: SSE (`/zil`) → 3 hata/2 dk ya da 403/404 → uzun yoklama (`/bekle`) → `/bekle` 404
// (eski backend) → 30 sn `/ozet` yoklaması. Akış İÇERİKSİZDİR: zil gelince özet yeniden okunur, liste
// sorguları "degisti" olayıyla tazelenir; `epoch` (sunucu açılış damgası) değişirse "tam" olayı = her şey
// baştan çekilir. `/ozet` 404 ya da bayrak kapalı → kip "kapali", zil çizilmez.
// Tek örnek: bileşenler `abone` olur (referans sayımı); Chromium HTTP/1.1'de sunucu başı 6 bağlantı var.
// =============================================================================
import type { NotificationWaitResult, NotificationSummary } from "./types";
import { asNumber, parseJsonObject, readSseEvents } from "./sse-okuyucu";

export { readSseEvents };

export type BellMode = "kapali" | "sse" | "bekle" | "ozet";
/** "alarm" = `alarmRev` değişti (tezgah alarmı): panelin alarm sorgusu hemen tazelenir. */
export type BellEvent = "degisti" | "tam" | "alarm";

export interface BellState {
  /** İlk özet cevabı geldi mi (gelmeden zil çizilmez). */
  hazir: boolean;
  /** false = eski backend (`/ozet` 404) → zil hiç çizilmez. */
  destek: boolean;
  /** Sunucunun bayrak cevabı (`ozet.enabled`). */
  enabled: boolean;
  okunmamis: number;
  alarmAcik: number;
  epoch: number | null;
  rev: number;
  alarmRev: number;
  kip: BellMode;
  /** SSE akışı açık ve `merhaba` gelmiş (sağlıklı) — alarm yoklaması buna göre seyrekleşir. */
  bagli: boolean;
}

/** Akış sağlıklı mı: zil gerçek zamanlıysa alarm yoklaması yedektir (60 sn), değilse 15 sn sürer. */
export function bellStreamHealthy(s: Pick<BellState, "enabled" | "kip" | "bagli">): boolean {
  return s.enabled && s.kip === "sse" && s.bagli;
}

export interface BellDeps {
  ozet(): Promise<NotificationSummary>;
  bekle(p: { rev: number; alarmRev: number; epoch: number }, signal: AbortSignal): Promise<NotificationWaitResult>;
  /** SSE isteği — `fetch` + başlıklar `buildAuthHeaders`ten (EventSource başlık taşıyamaz). */
  akisAc(signal: AbortSignal): Promise<Response>;
  /** Hatadan HTTP durumu (yanıt yoksa null). */
  httpDurum(e: unknown): number | null;
  simdi?(): number;
}

export const BELL_ERROR_THRESHOLD = 3;
export const BELL_ERROR_WINDOW_MS = 2 * 60_000;
export const BELL_SUMMARY_POLL_MS = 30_000;
export const BELL_RECONNECT_MS = [1_000, 3_000, 10_000] as const;
const WAIT_ERROR_BACKOFF_MS = 5_000;

const EMPTY_STATE: BellState = {
  hazir: false, destek: true, enabled: false, okunmamis: 0, alarmAcik: 0, epoch: null, rev: 0, alarmRev: 0, kip: "kapali", bagli: false,
};

export interface BellClient {
  durum(): BellState;
  /** useSyncExternalStore uyumlu durum aboneliği. */
  dinle(fn: () => void): () => void;
  /** Liste tazeleme olayları ("degisti" | "tam"). */
  olayDinle(fn: (o: BellEvent) => void): () => void;
  /** Referans sayımlı başlatma; dönen fonksiyon bırakır (son bırakan akışı kapatır). */
  abone(): () => void;
  /** Eylem sonrası ya da bayrak açılınca: özeti yeniden oku, gerekirse akışı kur. */
  tazele(): Promise<void>;
}

/** Merdiven durumu sınıfta: her yöntem kısa kalır, `nesil` eski döngüleri sessizce bitirir. */
class BellEngine implements BellClient {
  private d: BellState = { ...EMPTY_STATE };
  private aboneSayisi = 0;
  private nesil = 0;
  private abort: AbortController | null = null;
  private zamanlayici: ReturnType<typeof setTimeout> | null = null;
  private hatalar: number[] = [];
  /** Son olaydan beri `alarmRev` değişti mi (ilk okuma sayılmaz). */
  private alarmDegisti = false;
  /** 403/404 nedeniyle düşüldüyse görünürlük olayı SSE'yi yeniden denemez. */
  private zorunluDusus = false;
  private readonly durumDinleyici = new Set<() => void>();
  private readonly olayDinleyici = new Set<(o: BellEvent) => void>();
  private readonly simdi: () => number;

  constructor(private readonly dep: BellDeps) {
    this.simdi = dep.simdi ?? (() => Date.now());
  }

  durum = (): BellState => this.d;

  dinle = (fn: () => void): (() => void) => {
    this.durumDinleyici.add(fn);
    return () => void this.durumDinleyici.delete(fn);
  };

  olayDinle = (fn: (o: BellEvent) => void): (() => void) => {
    this.olayDinleyici.add(fn);
    return () => void this.olayDinleyici.delete(fn);
  };

  abone = (): (() => void) => {
    this.aboneSayisi++;
    if (this.aboneSayisi === 1) {
      if (typeof window !== "undefined") {
        window.addEventListener("online", this.yenidenBaglan);
        document.addEventListener("visibilitychange", this.gorunurlukDegisti);
      }
      void this.kur();
    }
    let birakildi = false;
    return () => {
      if (birakildi) return;
      birakildi = true;
      this.aboneSayisi--;
      if (this.aboneSayisi > 0) return;
      if (typeof window !== "undefined") {
        window.removeEventListener("online", this.yenidenBaglan);
        document.removeEventListener("visibilitychange", this.gorunurlukDegisti);
      }
      this.tasimaDurdur();
      this.yayinla({ kip: "kapali" });
    };
  };

  tazele = (): Promise<void> => this.kur();

  private yayinla(yeni: Partial<BellState>) {
    this.d = { ...this.d, ...yeni };
    this.durumDinleyici.forEach((f) => f());
  }

  private olay(o: BellEvent) {
    this.olayDinleyici.forEach((f) => f(o));
    if (!this.alarmDegisti) return;
    this.alarmDegisti = false;
    this.olayDinleyici.forEach((f) => f("alarm"));
  }

  private bekleMs(ms: number, n: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.zamanlayici = setTimeout(() => {
        this.zamanlayici = null;
        resolve(n === this.nesil);
      }, ms);
    });
  }

  private tasimaDurdur() {
    this.nesil++;
    this.abort?.abort();
    this.abort = null;
    if (this.zamanlayici) clearTimeout(this.zamanlayici);
    this.zamanlayici = null;
  }

  /** Sürüm karşılaştırması: epoch değiştiyse "tam", rev değiştiyse "degisti". */
  private surumGor(epoch: number | null, rev: number | null, alarmRev: number | null): BellEvent | null {
    const d = this.d;
    let result: BellEvent | null = null;
    if (epoch !== null && d.epoch !== null && epoch !== d.epoch) result = "tam";
    else if ((rev !== null && rev !== d.rev) || (alarmRev !== null && alarmRev !== d.alarmRev)) result = "degisti";
    if (alarmRev !== null && alarmRev !== d.alarmRev && d.epoch !== null) this.alarmDegisti = true;
    this.yayinla({
      ...(epoch !== null ? { epoch } : {}),
      ...(rev !== null ? { rev } : {}),
      ...(alarmRev !== null ? { alarmRev } : {}),
    });
    return result;
  }

  private async ozetOku(): Promise<void> {
    let o: NotificationSummary;
    try {
      o = await this.dep.ozet();
    } catch (e) {
      if (this.dep.httpDurum(e) === 404) {
        this.tasimaDurdur();
        this.yayinla({ hazir: true, destek: false, enabled: false, kip: "kapali" });
      }
      return; // ağ hatası: son bilinen durum kalır, merdiven kendi yeniden dener
    }
    if (!o.enabled) {
      this.tasimaDurdur();
      this.yayinla({ hazir: true, destek: true, enabled: false, kip: "kapali" });
      return;
    }
    const ilk = this.d.epoch === null;
    const s = this.surumGor(o.epoch, o.rev, o.alarmRev);
    this.yayinla({ hazir: true, destek: true, enabled: true, okunmamis: o.okunmamis, alarmAcik: o.alarmAcik });
    if (s && !ilk) this.olay(s);
  }

  /** SSE/bekle bir değişiklik bildirdi: özet tazelenir, listeler olayı duyar. */
  private async degisiklik(s: BellEvent | null) {
    if (!s) return;
    await this.ozetOku();
    this.olay(s);
  }

  private hataKaydet(): boolean {
    const t = this.simdi();
    this.hatalar = [...this.hatalar.filter((x) => t - x < BELL_ERROR_WINDOW_MS), t];
    return this.hatalar.length >= BELL_ERROR_THRESHOLD;
  }

  /** Tek SSE bağlantısı; dönüş: "dus" (yoklamaya düş) · "bitti" (nesil değişti) · merhaba gelip gelmediği. */
  private async akisTuru(n: number, ac: AbortController): Promise<"dus" | "bitti" | { merhaba: boolean }> {
    let merhaba = false;
    try {
      const res = await this.dep.akisAc(ac.signal);
      if (n !== this.nesil) return "bitti";
      if (res.status === 403 || res.status === 404) {
        this.zorunluDusus = true;
        return "dus";
      }
      if (res.status === 409) {
        void this.ozetOku();
        return "bitti";
      }
      if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
      for await (const e of readSseEvents(res.body)) {
        if (n !== this.nesil) return "bitti";
        const v = parseJsonObject(e.data);
        if (e.event === "merhaba") {
          merhaba = true;
          this.hatalar = [];
          this.yayinla({ bagli: true });
          await this.degisiklik(this.surumGor(asNumber(v.epoch), asNumber(v.rev), asNumber(v.alarmRev)));
        } else if (e.event === "kapat") {
          // Sunucu akışı kapatıyor (ör. izin değişti): görünür türler değişmiş olabilir → tam çekim.
          await this.degisiklik("tam");
        } else if (e.event === "zil") {
          await this.degisiklik(this.surumGor(null, asNumber(v.rev), asNumber(v.alarmRev)) ?? "degisti");
        }
      }
    } catch {
      if (n !== this.nesil || ac.signal.aborted) return "bitti";
    } finally {
      if (this.d.bagli) this.yayinla({ bagli: false });
    }
    return { merhaba };
  }

  private async sseDongu(n: number) {
    while (n === this.nesil && this.d.kip === "sse") {
      const ac = new AbortController();
      this.abort = ac;
      const r = await this.akisTuru(n, ac);
      if (r === "bitti" || n !== this.nesil) return;
      if (r === "dus") return this.bekleKipi(n);
      // Sunucunun 30 dk ömürle kapattığı sağlıklı akış hata değildir; merhaba gelmeden kopan akış hatadır.
      if (!r.merhaba && this.hataKaydet()) return this.bekleKipi(n);
      const sira = r.merhaba ? 0 : Math.min(this.hatalar.length, BELL_RECONNECT_MS.length) - 1;
      if (!(await this.bekleMs(BELL_RECONNECT_MS[sira] ?? 1_000, n))) return;
    }
  }

  private bekleKipi(n: number) {
    if (n !== this.nesil) return;
    this.yayinla({ kip: "bekle" });
    void this.bekleDongu(n);
  }

  private async bekleDongu(n: number) {
    while (n === this.nesil && this.d.kip === "bekle") {
      const ac = new AbortController();
      this.abort = ac;
      try {
        const d = this.d;
        const r = await this.dep.bekle({ rev: d.rev, alarmRev: d.alarmRev, epoch: d.epoch ?? 0 }, ac.signal);
        if (n !== this.nesil) return;
        const s = this.surumGor(r.epoch, r.rev, r.alarmRev);
        await this.degisiklik(s ?? (r.degisti ? "degisti" : null));
      } catch (e) {
        if (n !== this.nesil || ac.signal.aborted) return;
        const st = this.dep.httpDurum(e);
        if (st === 404 || st === 403) return this.ozetKipi(n);
        if (st === 409) return void this.ozetOku();
        if (!(await this.bekleMs(WAIT_ERROR_BACKOFF_MS, n))) return;
      }
    }
  }

  private ozetKipi(n: number) {
    if (n !== this.nesil) return;
    this.yayinla({ kip: "ozet" });
    void (async () => {
      while (n === this.nesil && this.d.kip === "ozet") {
        if (!(await this.bekleMs(BELL_SUMMARY_POLL_MS, n))) return;
        await this.ozetOku();
      }
    })();
  }

  private async kur(): Promise<void> {
    await this.ozetOku();
    const d = this.d;
    if (this.aboneSayisi === 0 || !d.destek || !d.enabled || d.kip !== "kapali") return;
    this.sseBaslat();
  }

  private sseBaslat() {
    this.tasimaDurdur();
    this.hatalar = [];
    this.zorunluDusus = false;
    this.yayinla({ kip: "sse" });
    void this.sseDongu(this.nesil);
  }

  private gorunurlukDegisti = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    this.yenidenBaglan();
  };

  /** Ağ geri geldi / pencere öne geldi: hata yüzünden yoklamaya düşmüşsek SSE'yi yeniden dene. */
  private yenidenBaglan = () => {
    if (this.aboneSayisi === 0) return;
    if (this.d.kip === "bekle" && !this.zorunluDusus) return this.sseBaslat();
    void this.ozetOku();
  };
}

export function createBellClient(dep: BellDeps): BellClient {
  return new BellEngine(dep);
}
