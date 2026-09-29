// BİLDİRİM KATALOĞU — tür başına kural tek kaynak KODDADIR: kaynak projeksiyon, gereken izinler (HEPSİ),
// finans sınıfı. Kural (açılışta ölçülür, tutarsız katalog sunucuyu KALDIRMAZ):
//   · türün izinleri, kaynak projeksiyonun okuma izinlerini KAPSAR (bildirim, okunamayan veriyi sızdırmaz);
//   · finans içerikli tür en az bir finans okuma izni ister (finans izni olmayan hesaba finans bildirimi gitmez).
// Ayar şeması (`SettingsSchema`) KATIDIR; tanınmayan anahtar 400. Saat dilimi fabrika günüyle aynı: İstanbul.
import { z } from "zod";
import { NOTIFICATION_KINDS, type NotificationKind, type NotificationSettings } from "../wire/api";
import { type CloudPermission } from "./permissions";
import { projectionDef } from "./projections";

export interface KindRule {
  readonly label: string;
  readonly description: string;
  /** Olayın okunduğu projeksiyon (null = hesabın kendi kaydı / eşitleme durumu). */
  readonly source: string | null;
  readonly permissions: readonly CloudPermission[];
  readonly finance: boolean;
}

/** Finans okuma izinleri — finans içerikli tür bunlardan en az birini ister. */
export const FINANCE_PERMISSIONS: readonly CloudPermission[] = [
  "bulut:cari-bakiye:oku",
  "bulut:kasa:oku",
  "bulut:cek:oku",
  "bulut:fatura:oku",
  "bulut:tahsilat:oku",
  "bulut:fiyat:oku",
];

export const KIND_RULES: Readonly<Record<NotificationKind, KindRule>> = {
  "gelen-kutusu-sonucu": {
    label: "Gelen kutusu sonucu",
    description: "Gönderdiğiniz sipariş/cari fabrikada işlendi ya da reddedildi",
    source: null,
    permissions: ["bulut:oturum"],
    finance: false,
  },
  "stok-esigi": {
    label: "Stok eşiği",
    description: "Ham ya da bitmiş stok belirlediğiniz miktarın altına indi (günde en çok bir kez)",
    source: "ozet.stok",
    permissions: ["bulut:ozet:oku", "bulut:stok:oku"],
    finance: false,
  },
  "geciken-siparis": {
    label: "Geciken sipariş",
    description: "Termini geçmiş açık sipariş kalemi sayısı eşiği aştı (günde en çok bir kez)",
    source: "ozet.siparis",
    permissions: ["bulut:ozet:oku", "bulut:siparis:oku"],
    finance: false,
  },
  "gunluk-uretim": {
    label: "Günlük üretim",
    description: "Belirlediğiniz saatte bugün tamamlanan üretim eşiğin altında",
    source: "ozet.uretim",
    permissions: ["bulut:ozet:oku", "bulut:uretim:oku"],
    finance: false,
  },
  "esitleme-gecikti": {
    label: "Eşitleme gecikti",
    description: "Fabrikadan belirlediğiniz süre boyunca veri gelmedi",
    source: null,
    permissions: ["bulut:ozet:oku"],
    finance: false,
  },
  "yedek-basarisiz": {
    label: "Gece yedeği",
    description: "Fabrikanın gece yedeği alınamadı ya da gecikti",
    source: "saglik",
    permissions: ["bulut:ozet:oku"],
    finance: false,
  },
  "cek-vadesi": {
    label: "Çek/senet vadesi",
    description: "Vadesi geçmiş ya da yaklaşan çek/senet var (tutar içerir; günde en çok bir kez)",
    source: "ozet-finans",
    permissions: ["bulut:cari-bakiye:oku", "bulut:cek:oku"],
    finance: true,
  },
};

/** Katalog ölçümü — hata listesi (boşsa tutarlı). Açılışta ve bekçide koşar. */
export function catalogProblems(rules: Readonly<Record<string, KindRule>> = KIND_RULES): string[] {
  const out: string[] = [];
  for (const kind of NOTIFICATION_KINDS) if (!rules[kind]) out.push(`${kind}: kural yok`);
  for (const [kind, r] of Object.entries(rules)) {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) out.push(`${kind}: tel türü değil`);
    if (r.permissions.length === 0) out.push(`${kind}: izinsiz`);
    if (r.source) {
      const def = projectionDef(r.source);
      if (!def) out.push(`${kind}: kaynak projeksiyon yok (${r.source})`);
      else for (const p of def.permissions) if (!r.permissions.includes(p)) out.push(`${kind}: kaynağın izni kapsanmıyor (${p})`);
    }
    if (r.finance && !r.permissions.some((p) => FINANCE_PERMISSIONS.includes(p))) out.push(`${kind}: finans türü finans izni istemiyor`);
  }
  return out;
}

const problems = catalogProblems();
if (problems.length > 0) throw new Error(`Bildirim kataloğu tutarsız: ${problems.join("; ")}`);

/** Hesap bu türü alabilir mi (izin kümesi ⊇ türün izinleri). */
export function kindPermitted(kind: NotificationKind, permissions: ReadonlySet<string>): boolean {
  return KIND_RULES[kind].permissions.every((p) => permissions.has(p));
}

// ---------------------------------------------------------------- ayar şeması

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Saat SS:DD olmalı");
const Qty = z.number().finite().min(0).max(1e12).nullable();

export const SettingsSchema: z.ZodType<NotificationSettings> = z.strictObject({
  acik: z.boolean(),
  turler: z.strictObject(Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, z.boolean()])) as Record<NotificationKind, z.ZodBoolean>),
  sessiz: z.strictObject({ acik: z.boolean(), baslangic: Clock, bitis: Clock }),
  esikler: z.strictObject({
    hamStokAlt: Qty,
    bitmisStokAlt: Qty,
    gecikenKalemUst: z.number().int().min(0).max(1_000_000).nullable(),
    gunlukUretimAlt: Qty,
    gunlukUretimSaati: z.number().int().min(0).max(23),
    esitlemeGecikmeDk: z.number().int().min(5).max(10_080),
  }),
});

/** Koddaki varsayılan (tesis yöneticisi değiştirmediyse): bütün türler açık, eşikler kapalı, gece 22–07 sessiz. */
export const DEFAULT_SETTINGS: NotificationSettings = {
  acik: true,
  turler: Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, true])) as Record<NotificationKind, boolean>,
  sessiz: { acik: true, baslangic: "22:00", bitis: "07:00" },
  esikler: { hamStokAlt: null, bitmisStokAlt: null, gecikenKalemUst: 0, gunlukUretimAlt: null, gunlukUretimSaati: 18, esitlemeGecikmeDk: 60 },
};

/** Saklı ayar (jsonb) → şemadan geçen ayar; biçimsizse null (fail-closed: bir üst kaynağa düşülür). */
export function parseStored(value: unknown): NotificationSettings | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  // Yeni tür eklendiğinde eski satır geçersiz sayılmasın: eksik tür varsayılandan, kalkmış tür düşer.
  const v = value as Record<string, unknown>;
  const stored = v.turler && typeof v.turler === "object" ? (v.turler as Record<string, unknown>) : {};
  const turler = Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, k in stored ? stored[k] : DEFAULT_SETTINGS.turler[k]]));
  const r = SettingsSchema.safeParse({ ...v, turler });
  return r.success ? r.data : null;
}
