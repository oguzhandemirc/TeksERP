/**
 * mDNS tarayıcı — sunucunun ağa yaptığı `_teks-erp._tcp` ilanını dinler.
 *
 * ⚠️ Modül TEMBEL yüklenir ve her hata yutulur (`scanner.ipc.ts` deseni). mDNS
 * yoksa/çalışmıyorsa boş liste döner ve keşif alt ağ taramasıyla devam eder —
 * bu ayak kaybolduğunda özellik yavaşlar, ÖLMEZ.
 *
 * ⚠️ Backend tarafındaki ders burada da geçerli: `bonjour-service`in constructor'ı
 * hata geri-çağrısı almazsa bind hatasında `throw` eder. Burada da ikinci
 * parametre veriliyor.
 */
import { createRequire } from "node:module";
import { DISCOVERY_MDNS_TYPE } from "../../shared/discovery.js";

const req = createRequire(import.meta.url);

export interface MdnsHit {
  host: string;
  port: number;
  txt: Record<string, string | Uint8Array | undefined>;
  /** İlanda bildirilen IP adresleri — hostname çözülemezse bunlar kullanılır. */
  addresses: string[];
}

export interface MdnsBrowseResult {
  available: boolean;
  error: string | null;
  hits: MdnsHit[];
}

interface BonjourService {
  host?: string;
  port?: number;
  txt?: Record<string, string | Uint8Array | undefined>;
  addresses?: string[];
}
interface BrowserLike {
  on(ev: "up", cb: (s: BonjourService) => void): void;
  stop?: () => void;
}
interface BonjourLike {
  find(opts: { type: string }, onUp?: (s: BonjourService) => void): BrowserLike;
  destroy(cb?: () => void): void;
}

/**
 * `timeoutMs` boyunca dinler ve bulunanları döner. `onHit` verilirse her ilan
 * ANINDA bildirilir — çağıran doğrulamayı beklemeden başlatabilsin (turun
 * tamamını beklemek, tek sunuculu mutlu yolda 2 saniye boşa harcamak olurdu).
 */
export async function browseMdns(
  timeoutMs: number,
  onHit?: (hit: MdnsHit) => void,
): Promise<MdnsBrowseResult> {
  let Bonjour: new (o: unknown, cb: (e: unknown) => void) => BonjourLike;
  try {
    const mod = req("bonjour-service") as { Bonjour?: unknown; default?: unknown };
    const candidate = mod?.Bonjour ?? mod?.default ?? mod;
    if (typeof candidate !== "function") throw new Error("Bonjour sınıfı bulunamadı");
    Bonjour = candidate as typeof Bonjour;
  } catch (e) {
    return { available: false, error: (e as Error).message, hits: [] };
  }

  const hits: MdnsHit[] = [];
  let instance: BonjourLike | null = null;
  let bindError: string | null = null;

  try {
    // ⚠️ İkinci parametre: yoksa bind hatası THROW eder (backend notuna bak).
    instance = new Bonjour({}, (e: unknown) => {
      bindError = e instanceof Error ? e.message : String(e);
    });

    const browser = instance.find({ type: DISCOVERY_MDNS_TYPE }, (svc) => {
      const hit: MdnsHit = {
        host: svc.host ?? "",
        port: svc.port ?? 0,
        txt: svc.txt ?? {},
        addresses: Array.isArray(svc.addresses) ? svc.addresses : [],
      };
      hits.push(hit);
      try {
        onHit?.(hit);
      } catch {
        /* çağıranın hatası bizim turu düşürmesin */
      }
    });

    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    try {
      browser.stop?.();
    } catch {
      /* yoksay */
    }
  } catch (e) {
    return { available: false, error: (e as Error).message, hits };
  } finally {
    try {
      instance?.destroy();
    } catch {
      /* yoksay */
    }
  }

  return { available: bindError === null, error: bindError, hits };
}
