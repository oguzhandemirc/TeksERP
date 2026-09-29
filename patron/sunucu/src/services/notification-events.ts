// BİLDİRİM OLAY ÜRETİMİ — durumsuz tarama: her turda tesisin olgularına bakılır, koşul tutan her (hesap, olay)
// için İDEMPOTENT bildirim kimliği (`dedup_key`) üretilir ve satır `ON CONFLICT DO NOTHING` ile doğar ⇒ aynı olay
// aynı hesaba İKİNCİ kez doğamaz. BULUT HESAP YAPMAZ: eşik, fabrikanın gönderdiği özet sayısıyla YALNIZ
// karşılaştırılır (toplama/türetme yok). Kural düşüren (kapalı · tür kapalı · izin yok) olay da ATLANDI olarak
// doğar ki tür sonradan açılınca eski olay gönderilmesin. Değerlendirme saf (`evaluate`), yazım ayrı.
import { KIND_RULES, kindPermitted } from "../catalog/notifications";
import { effectivePermissions } from "../catalog/permissions";
import { istanbulDay, istanbulMinute } from "../lib/istanbul";
import { withTesis } from "../lib/tenant";
import type { NotificationKind, NotificationSettings } from "../wire/api";
import type { CloudContext } from "./context";
import { loadFacilitySettings, resolveSettings } from "./notification-settings.service";

export interface Candidate {
  readonly accountId: string;
  readonly kind: NotificationKind;
  readonly dedupKey: string;
  readonly title: string;
  readonly body: string;
  readonly route: string | null;
}

export interface FacilityFacts {
  readonly nowMs: number;
  readonly accounts: readonly { readonly id: string; readonly settings: NotificationSettings }[];
  readonly snapshots: ReadonlyMap<string, unknown>;
  readonly lastPackageAt: Date | null;
  readonly inbox: readonly { readonly messageId: string; readonly accountId: string; readonly kind: string; readonly status: string }[];
}

/** Olayların okunduğu anlık projeksiyonlar (katalogdaki `source`lar). */
export const SNAPSHOT_SOURCES: readonly string[] = [...new Set(Object.values(KIND_RULES).map((r) => r.source).filter((s): s is string => s !== null))];

const INBOX_WINDOW_MS = 24 * 3_600_000;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const fmt = (n: number): string => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const DUE_LABEL: Readonly<Record<string, string>> = { OVERDUE: "vadesi geçmiş", SOON: "vadesi yaklaşan" };

/** Saf değerlendirme: hesap × olay adayları (izin/tür/sessiz kararı YAZIMDA ve GÖNDERİMDE verilir). */
export function evaluate(f: FacilityFacts): Candidate[] {
  const day = istanbulDay(f.nowMs);
  const out: Candidate[] = [];
  const stock = obj(f.snapshots.get("ozet.stok"));
  const orders = obj(f.snapshots.get("ozet.siparis"));
  const production = obj(f.snapshots.get("ozet.uretim"));
  const backup = obj(obj(f.snapshots.get("saglik")).yedek);
  const cheques = obj(f.snapshots.get("ozet-finans")).cekVade;
  for (const a of f.accounts) {
    const e = a.settings.esikler;
    const add = (kind: NotificationKind, dedupKey: string, text: { title: string; body: string; route: string | null }) =>
      out.push({ accountId: a.id, kind, dedupKey, ...text });
    const raw = num(stock.hamMiktar);
    if (e.hamStokAlt !== null && raw !== null && raw < e.hamStokAlt) add("stok-esigi", `stok-esigi:ham:${day}`, { title: "Ham stok eşiğin altında", body: `Ham stok ${fmt(raw)} (eşik ${fmt(e.hamStokAlt)})`, route: "/stok" });
    const fin = num(stock.bitmisMiktar);
    if (e.bitmisStokAlt !== null && fin !== null && fin < e.bitmisStokAlt) add("stok-esigi", `stok-esigi:bitmis:${day}`, { title: "Bitmiş stok eşiğin altında", body: `Bitmiş stok ${fmt(fin)} (eşik ${fmt(e.bitmisStokAlt)})`, route: "/stok" });
    const late = num(orders.gecikenKalem);
    if (e.gecikenKalemUst !== null && late !== null && late > e.gecikenKalemUst) add("geciken-siparis", `geciken-siparis:${day}`, { title: "Geciken sipariş", body: `Termini geçmiş ${fmt(late)} açık kalem var`, route: "/siparisler" });
    const today = num(production.bugunTamamlananToplam);
    if (e.gunlukUretimAlt !== null && today !== null && istanbulMinute(f.nowMs) >= e.gunlukUretimSaati * 60 && today < e.gunlukUretimAlt) {
      add("gunluk-uretim", `gunluk-uretim:${day}`, { title: "Günlük üretim düşük", body: `Bugün tamamlanan ${fmt(today)} (eşik ${fmt(e.gunlukUretimAlt)})`, route: "/uretim" });
    }
    if (f.lastPackageAt && f.nowMs - f.lastPackageAt.getTime() > e.esitlemeGecikmeDk * 60_000) {
      const dk = Math.floor((f.nowMs - f.lastPackageAt.getTime()) / 60_000);
      add("esitleme-gecikti", `esitleme-gecikti:${f.lastPackageAt.toISOString()}`, { title: "Fabrikadan veri gelmiyor", body: `Son eşitleme ${dk} dakika önce`, route: "/pano" });
    }
    if (backup.hukum === "kritik" || backup.hukum === "uyari") {
      const last = typeof backup.sonGeceYedegi === "string" ? backup.sonGeceYedegi : "yok";
      const age = num(backup.yasSaat);
      add("yedek-basarisiz", `yedek-basarisiz:${last}`, { title: "Gece yedeği alınamadı", body: age === null ? "Fabrikada gece yedeği bulunamadı" : `Son gece yedeği ${fmt(age)} saat önce`, route: "/pano" });
    }
    if (Array.isArray(cheques)) {
      const rows = cheques.map(obj).filter((c) => (c.kova === "OVERDUE" || c.kova === "SOON") && (num(c.adet) ?? 0) > 0);
      if (rows.length > 0) {
        const text = rows.slice(0, 3).map((c) => `${DUE_LABEL[String(c.kova)]} ${String(c.tur)} ${String(c.adet)} adet ${String(c.tutar)} ${String(c.doviz)}`).join(" · ");
        add("cek-vadesi", `cek-vadesi:${day}`, { title: "Çek/senet vadesi", body: text.slice(0, 480), route: "/finans" });
      }
    }
  }
  for (const m of f.inbox) {
    if (m.status !== "ISLENDI" && m.status !== "REDDEDILDI") continue;
    if (!f.accounts.some((a) => a.id === m.accountId)) continue;
    const what = m.kind === "SIPARIS" ? "Sipariş" : "Cari";
    const verb = m.status === "ISLENDI" ? "fabrikada işlendi" : "fabrikada reddedildi";
    out.push({ accountId: m.accountId, kind: "gelen-kutusu-sonucu", dedupKey: `gelen-kutusu:${m.messageId}:${m.status}`, title: `${what} ${m.status === "ISLENDI" ? "işlendi" : "reddedildi"}`, body: `${what} mesajınız ${verb}`, route: `/gelen-kutusu/${m.messageId}` });
  }
  return out;
}

/** Doğuşta kural kararı: null = kuyruğa (BEKLIYOR), değilse atlama gerekçesi. Gönderimde AYNI karar yeniden verilir. */
export function ruleVerdict(settings: NotificationSettings, kind: NotificationKind, permissions: ReadonlySet<string>): string | null {
  if (!settings.acik) return "BILDIRIM_KAPALI";
  if (!settings.turler[kind]) return "TUR_KAPALI";
  if (!kindPermitted(kind, permissions)) return "IZIN_YOK";
  return null;
}

/** Tesisin olaylarını üret: yeni doğan satır sayısı (tekrarlar sessizce yok sayılır). */
export async function generateForFacility(ctx: CloudContext, tesisId: string, nowMs: number): Promise<number> {
  return withTesis(ctx.app, { tesisId, projections: SNAPSHOT_SOURCES }, async (tx) => {
    const accounts = await tx.account.findMany({ where: { tesisId, status: "AKTIF" }, select: { id: true, permissions: true }, orderBy: { id: "asc" } });
    if (accounts.length === 0) return 0;
    const cfg = await loadFacilitySettings(tx, tesisId);
    const settingsOf = new Map(accounts.map((a) => [a.id, resolveSettings(cfg.byAccount.get(a.id) ?? null, cfg.facility).settings]));
    const snaps = await tx.projectionRow.findMany({ where: { tesisId, projection: { in: [...SNAPSHOT_SOURCES] }, deletedAt: null }, select: { projection: true, data: true } });
    const state = await tx.syncState.findUnique({ where: { tesisId }, select: { lastPackageAt: true } });
    const inbox = await tx.inboxMessage.findMany({
      where: { tesisId, status: { in: ["ISLENDI", "REDDEDILDI"] }, processedAt: { gte: new Date(nowMs - INBOX_WINDOW_MS) } },
      select: { messageId: true, accountId: true, kind: true, status: true },
    });
    const candidates = evaluate({
      nowMs,
      accounts: accounts.map((a) => ({ id: a.id, settings: settingsOf.get(a.id)! })),
      snapshots: new Map(snaps.map((s) => [s.projection, s.data])),
      lastPackageAt: state?.lastPackageAt ?? null,
      inbox,
    });
    if (candidates.length === 0) return 0;
    const perms = new Map(accounts.map((a) => [a.id, effectivePermissions(a.permissions)]));
    const now = new Date(nowMs);
    const r = await tx.notification.createMany({
      skipDuplicates: true,
      data: candidates.map((c) => {
        const skip = ruleVerdict(settingsOf.get(c.accountId)!, c.kind, perms.get(c.accountId)!);
        return { tesisId, accountId: c.accountId, kind: c.kind, dedupKey: c.dedupKey, title: c.title, body: c.body, route: c.route, nextAttemptAt: now, ...(skip ? { status: "ATLANDI" as const, skipReason: skip } : {}) };
      }),
    });
    return r.count;
  });
}
