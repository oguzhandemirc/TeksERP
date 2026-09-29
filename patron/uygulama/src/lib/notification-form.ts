// Bildirim ayarları formu (saf): ayar ↔ form metni, doğrulama TR. Kural sunucudadır (katı şema); burada yalnız
// kullanıcıya erken ve anlaşılır hata göstermek için aynı sınırlar. Bildirime dokununca açılacak yol da burada süzülür.
import { MODULES } from "./access";
import { NOTIFICATION_KINDS, type NotificationKind, type NotificationSettings } from "../api/wire";

export interface NotificationForm {
  readonly acik: boolean;
  readonly turler: Readonly<Record<NotificationKind, boolean>>;
  readonly sessizAcik: boolean;
  readonly baslangic: string;
  readonly bitis: string;
  readonly hamStokAlt: string;
  readonly bitmisStokAlt: string;
  readonly gecikenKalemUst: string;
  readonly gunlukUretimAlt: string;
  readonly gunlukUretimSaati: string;
  readonly esitlemeGecikmeDk: string;
}

const text = (n: number | null): string => (n === null ? "" : String(n).replace(".", ","));

export function toForm(s: NotificationSettings): NotificationForm {
  return {
    acik: s.acik,
    turler: s.turler,
    sessizAcik: s.sessiz.acik,
    baslangic: s.sessiz.baslangic,
    bitis: s.sessiz.bitis,
    hamStokAlt: text(s.esikler.hamStokAlt),
    bitmisStokAlt: text(s.esikler.bitmisStokAlt),
    gecikenKalemUst: text(s.esikler.gecikenKalemUst),
    gunlukUretimAlt: text(s.esikler.gunlukUretimAlt),
    gunlukUretimSaati: String(s.esikler.gunlukUretimSaati),
    esitlemeGecikmeDk: String(s.esikler.esitlemeGecikmeDk),
  };
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Boş = eşik kapalı (null); sayı TR ondalıkla da yazılabilir. */
function optional(label: string, v: string, g: { integer?: boolean; max?: number } = {}): number | null {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || (g.integer && !Number.isInteger(n)) || n > (g.max ?? 1e12)) throw new Error(`${label} geçersiz`);
  return n;
}

function required(label: string, v: string, min: number, max: number): number {
  const n = Number(v.trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} ${min}–${max} arasında tam sayı olmalı`);
  return n;
}

export function fromForm(f: NotificationForm): { ok: true; settings: NotificationSettings } | { ok: false; error: string } {
  try {
    if (!CLOCK.test(f.baslangic) || !CLOCK.test(f.bitis)) throw new Error("Sessiz saatler SS:DD biçiminde olmalı (ör. 22:00)");
    const turler = Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, f.turler[k] ?? true])) as Record<NotificationKind, boolean>;
    return {
      ok: true,
      settings: {
        acik: f.acik,
        turler,
        sessiz: { acik: f.sessizAcik, baslangic: f.baslangic, bitis: f.bitis },
        esikler: {
          hamStokAlt: optional("Ham stok eşiği", f.hamStokAlt),
          bitmisStokAlt: optional("Bitmiş stok eşiği", f.bitmisStokAlt),
          gecikenKalemUst: optional("Geciken kalem eşiği", f.gecikenKalemUst, { integer: true, max: 1_000_000 }),
          gunlukUretimAlt: optional("Günlük üretim eşiği", f.gunlukUretimAlt),
          gunlukUretimSaati: required("Günlük üretim saati", f.gunlukUretimSaati, 0, 23),
          esitlemeGecikmeDk: required("Eşitleme gecikmesi (dk)", f.esitlemeGecikmeDk, 5, 10_080),
        },
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const RECORD_ROUTES = new Set(["/gelen-kutusu", "/raporlar", "/siparisler", "/cariler"]);

/** Bildirimin taşıdığı yol yalnız uygulamanın KENDİ ekranıysa açılır (dış adres, `//`, bilinmeyen bölüm → null). */
export function safeRoute(rota: unknown): string | null {
  if (typeof rota !== "string" || !/^\/[a-z-]+(\/[A-Za-z0-9-]{1,64})?$/.test(rota)) return null;
  const [, first, second] = rota.split("/");
  const base = `/${first}`;
  if (!MODULES.some((m) => m.route === base)) return null;
  if (second !== undefined && !RECORD_ROUTES.has(base)) return null;
  return rota;
}

/** Web push `applicationServerKey`: base64url → bayt dizisi. */
export function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
