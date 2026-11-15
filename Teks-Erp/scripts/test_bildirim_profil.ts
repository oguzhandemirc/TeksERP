// =============================================================================
// BEKÇİ — BİLDİRİM TERCİH PROFİLLERİ (2026-11-15) — saf türetim + HTTP, süreç içi sunucu
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_profil
// =============================================================================
//   §1 hazır profiller katalogdan TÜRER: her grup tam bir departmanda · ALARM her profilde · HEPSI = katalog ·
//      SESSIZ = ALARM · ONEMLI = önemli ∪ ALARM · sahte satır yüklemle doğru profile girer (liste elle yazılmaz)
//   §2 UYGULAMA'ya uygula: ⭐ kilitli tür açık kalır · diğerleri kapanır · etkin = SESSIZ · tekrar = aynı satırlar
//      (idempotent) · yan kanal (MASAUSTU) satırı korunur · HEPSI'ye dönüş
//   §3 PATRON_PUSH'a uygula: önemli türde telefon açık ve uygulama içi açılır, ötekinde telefon kapalı; etkin = ONEMLI
//   §4 kapsam satırı uygulamada korunur
//   §5 kişisel profil: kaydet (201) · replay TEK kayıt · çakışan token 409 · aynı ad (harf duyarsız) 409 · uygula + etkin ·
//      yeniden adlandır · seçimi güncelle · başkasının profili 404 · sil = arşiv · ikinci silme 409 · silinmişi uygulamak 409 ·
//      silinen ad yeniden kullanılabilir · audit satırı
//   §6 görme süzgeci: görülemeyen tür hazır listede yok; doğrulama 400'leri
//   §7 yönetici `profiller/hazir`: izinsiz 403, izinli tam küme
//   §8 bayrak kapalı → 409 `BILDIRIM_KAPALI`
//
// NEGATİF SONDA (2026-11-15, kopya + md5 ile geri alındı): `buildItems`te kilitli tür atlaması kaldırıldı → §2a ❌ (uygula 409).
// NEGATİF SONDA (2026-11-15, kopya + md5 ile geri alındı): `PRESET_DEPARTMENT_GROUPS`tan "Personel" silindi → §1a ❌.
// Global ayar yazar (`bildirim.gelenKutusuEnabled`); fikstür bulduğu değere döner. Yalnız kendi kullanıcı satırlarına dokunur.
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_GRUPLARI,
  NOTIFICATION_KINDS,
  type NotificationCatalogEntry,
} from "../src/constants/notification-catalog";
import { PRESET_DEPARTMENT_GROUPS, PRESET_PROFILES, getPresetProfile, presetKinds } from "../src/constants/notification-preset-profiles";
import { BildirimFikstur, type FiksturKullanici } from "./lib/bildirim-http-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ek = Date.now().toString(36);
const fx = new BildirimFikstur(`bprof-${ek}`);

const YEDEK = "sistem.yedek-basarisiz"; // kilit HER_ZAMAN · system:backups
const ESITLEME = "sistem.esitleme-gecikti"; // kilit YOK · admin:users
const TERMIN = "siparis.termin-yaklasti"; // kapsam yalnizTakip · order:read
const SERTIFIKA = "kalite.sertifika-suresi-doluyor"; // certificate:read — kişide YOK

const entry = (k: string) => (NOTIFICATION_CATALOG as Record<string, NotificationCatalogEntry>)[k];
const code = (r: { json: any }) => r.json?.error?.details?.code ?? r.json?.details?.code;
const same = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function bolum1(): void {
  console.log("=== §1 hazır profiller katalogdan türer ===");
  const missing = NOTIFICATION_GRUPLARI.filter((g) => !(g in PRESET_DEPARTMENT_GROUPS));
  check("§1a ⭐ her katalog grubu bir departman profiline bağlı", missing.length === 0, missing.join(",") || "tam");
  const deptCodes = new Set(Object.values(PRESET_DEPARTMENT_GROUPS));
  check("§1a2 departman haritası yalnız departman profillerine gider", [...deptCodes].every((c) => ["URETIM", "SATIS_SEVKIYAT", "FINANS", "GUVENLIK"].includes(c)), [...deptCodes].join(","));
  const alarms = NOTIFICATION_KINDS.filter((k) => entry(k).sinif === "ALARM");
  check("§1b ALARM sınıfı her profilde", alarms.length > 0 && PRESET_PROFILES.every((p) => alarms.every((a) => presetKinds(p).includes(a))), `${alarms.length} alarm`);
  check("§1c HEPSI = bütün katalog", presetKinds(getPresetProfile("HEPSI")!).length === NOTIFICATION_KINDS.length, `${NOTIFICATION_KINDS.length}`);
  check("§1d SESSIZ = yalnız ALARM", same(presetKinds(getPresetProfile("SESSIZ")!), alarms));
  const important = NOTIFICATION_KINDS.filter((k) => entry(k).onemli === true || entry(k).sinif === "ALARM");
  check("§1e ONEMLI = önemli ∪ ALARM", same(presetKinds(getPresetProfile("ONEMLI")!), important), `${important.length}`);
  for (const [grup, dept] of Object.entries(PRESET_DEPARTMENT_GROUPS)) {
    const kinds = NOTIFICATION_KINDS.filter((k) => entry(k).grup === grup);
    const p = getPresetProfile(dept)!;
    if (kinds.length && !kinds.every((k) => presetKinds(p).includes(k))) check(`§1f ${grup} türleri ${dept} profilinde`, false);
  }
  check("§1f her grubun türleri kendi departman profilinde", true);
  const base = entry(ESITLEME);
  const fake = (over: Partial<NotificationCatalogEntry>): NotificationCatalogEntry => ({ ...base, onemli: undefined, ozet: undefined, sinif: "BILDIRIM", ...over });
  const finans = fake({ grup: "Finans" });
  check("§1g sahte Finans satırı: FINANS içinde, URETIM/SESSIZ dışında", getPresetProfile("FINANS")!.includes(finans) && !getPresetProfile("URETIM")!.includes(finans) && !getPresetProfile("SESSIZ")!.includes(finans));
  check("§1h sahte özet satırı OZETLER'de, özetsiz olan değil", getPresetProfile("OZETLER")!.includes(fake({ grup: "Dokuma", ozet: "GUN_SONU" })) && !getPresetProfile("OZETLER")!.includes(fake({ grup: "Dokuma" })));
  check("§1i sahte önemli Sevkiyat satırı FINANS'a da girer, GUVENLIK'e girmez", getPresetProfile("FINANS")!.includes(fake({ grup: "Sevkiyat", onemli: true })) && !getPresetProfile("GUVENLIK")!.includes(fake({ grup: "Sevkiyat", onemli: true })));
}

type Cell = { kind: string; kanallar: Array<{ kanal: string; durum: string; kilit: boolean }> };
const cellState = (cells: Cell[], kind: string, kanal: string) => cells.find((h) => h.kind === kind)?.kanallar.find((k) => k.kanal === kanal);

async function apply(u: FiksturKullanici, body: unknown) {
  return fx.istek(u.token, "POST", "/api/bildirim/tercihler/profil-uygula", body);
}
async function ownRows(u: FiksturKullanici) {
  const rows = await prisma.notificationPreference.findMany({ where: { userId: u.id }, select: { kind: true, channel: true, enabled: true, scope: true }, orderBy: [{ kind: "asc" }, { channel: "asc" }] });
  return rows;
}

async function bolum2(a: FiksturKullanici): Promise<void> {
  console.log("\n=== §2 UYGULAMA'ya uygula ===");
  const put = await fx.istek(a.token, "PUT", "/api/bildirim/tercihler", { tercihler: [{ tur: ESITLEME, kanal: "MASAUSTU", acik: true }] });
  check("§2 ön koşul: MASAUSTU satırı yazıldı", put.status === 200);
  const r = await apply(a, { kanal: "UYGULAMA", hazir: "SESSIZ" });
  const cells: Cell[] = r.json?.data?.hucreler ?? [];
  check("§2a ⭐ SESSIZ: kilitli tür (yedek) açık kalır", r.status === 200 && cellState(cells, YEDEK, "UYGULAMA")?.durum === "ACIK", `${r.status} ${code(r) ?? ""}`);
  const nonLocked = cells.filter((h) => !h.kanallar.find((k) => k.kanal === "UYGULAMA")?.kilit && entry(h.kind)?.sinif !== "ALARM");
  check("§2b SESSIZ: kilitsiz, alarm olmayan her tür kapalı", nonLocked.length > 0 && nonLocked.every((h) => cellState(cells, h.kind, "UYGULAMA")?.durum === "KAPALI"), `${nonLocked.length} tür`);
  check("§2c etkin = hazir:SESSIZ, HEPSI değil", (r.json?.data?.profiller?.etkin ?? []).includes("hazir:SESSIZ") && !(r.json?.data?.profiller?.etkin ?? []).includes("hazir:HEPSI"), JSON.stringify(r.json?.data?.profiller?.etkin));
  const before = JSON.stringify(await ownRows(a));
  const r2 = await apply(a, { kanal: "UYGULAMA", hazir: "SESSIZ" });
  check("§2d tekrar uygulama aynı satırları bırakır (idempotent)", r2.status === 200 && JSON.stringify(await ownRows(a)) === before);
  const masaustu = (await ownRows(a)).find((x) => x.kind === ESITLEME && x.channel === "MASAUSTU");
  check("§2e yan kanal (MASAUSTU) satırı korunur", masaustu?.enabled === true);
  const r3 = await apply(a, { kanal: "UYGULAMA", hazir: "HEPSI" });
  const c3: Cell[] = r3.json?.data?.hucreler ?? [];
  check("§2f HEPSI: her tür açık, etkin = HEPSI", r3.status === 200 && c3.every((h) => cellState(c3, h.kind, "UYGULAMA")?.durum === "ACIK") && (r3.json?.data?.profiller?.etkin ?? []).includes("hazir:HEPSI"));
  const g = await fx.istek(a.token, "GET", "/api/bildirim/tercihler/profiller?kanal=UYGULAMA");
  check("§2g GET profiller etkin ile tutarlı", g.status === 200 && (g.json?.data?.etkin ?? []).includes("hazir:HEPSI") && g.json?.data?.hazir?.length === PRESET_PROFILES.length);
}

async function bolum3(a: FiksturKullanici): Promise<void> {
  console.log("\n=== §3 PATRON_PUSH'a uygula ===");
  await apply(a, { kanal: "UYGULAMA", hazir: "SESSIZ" });
  const r = await apply(a, { kanal: "PATRON_PUSH", hazir: "ONEMLI" });
  const cells: Cell[] = r.json?.data?.hucreler ?? [];
  const imp = cells.filter((h) => entry(h.kind)?.onemli === true);
  const rest = cells.filter((h) => entry(h.kind)?.onemli !== true && entry(h.kind)?.sinif !== "ALARM");
  check("§3a önemli türde telefon açık ve uygulama içi yeniden açıldı", r.status === 200 && imp.length > 0 && imp.every((h) => cellState(cells, h.kind, "PATRON_PUSH")?.durum === "ACIK" && cellState(cells, h.kind, "UYGULAMA")?.durum === "ACIK"), `${r.status} ${imp.length} önemli`);
  check("§3b önemli olmayan türde telefon kapalı", rest.length > 0 && rest.every((h) => cellState(cells, h.kind, "PATRON_PUSH")?.durum === "KAPALI"));
  check("§3c etkin (PATRON_PUSH) = ONEMLI", (r.json?.data?.profiller?.etkin ?? []).includes("hazir:ONEMLI") && r.json?.data?.profiller?.kanal === "PATRON_PUSH", JSON.stringify(r.json?.data?.profiller?.etkin));
  const masaustu = (await ownRows(a)).find((x) => x.kind === ESITLEME && x.channel === "MASAUSTU");
  check("§3d telefon profili masaüstü satırına dokunmaz", masaustu?.enabled === true);
}

async function bolum4(a: FiksturKullanici): Promise<void> {
  console.log("\n=== §4 kapsam korunur ===");
  await apply(a, { kanal: "UYGULAMA", hazir: "HEPSI" });
  const put = await fx.istek(a.token, "PUT", "/api/bildirim/tercihler", { tercihler: [{ tur: TERMIN, kanal: "UYGULAMA", acik: true, kapsam: { yalnizTakip: true } }] });
  const r = await apply(a, { kanal: "UYGULAMA", hazir: "SATIS_SEVKIYAT" });
  const row = (await ownRows(a)).find((x) => x.kind === TERMIN && x.channel === "UYGULAMA");
  const sc = row?.scope as Record<string, unknown> | null | undefined;
  check("§4a uygulama sonrası kapsam satırı yerinde", put.status === 200 && r.status === 200 && row?.enabled === true && sc?.yalnizTakip === true, JSON.stringify(row));
}

async function bolum5(a: FiksturKullanici, c: FiksturKullanici): Promise<void> {
  console.log("\n=== §5 kişisel profil ===");
  await apply(a, { kanal: "UYGULAMA", hazir: "FINANS" });
  const token = randomUUID();
  const create = (body: unknown) => fx.istek(a.token, "POST", "/api/bildirim/tercihler/profiller", body);
  const r1 = await create({ ad: "Gece", kanal: "UYGULAMA", clientToken: token });
  const id: string | undefined = r1.json?.data?.profil?.id;
  check("§5a kaydet → 201, şimdiki seçim etkin", r1.status === 201 && !!id && (r1.json?.data?.profiller?.etkin ?? []).includes(`kisisel:${id}`), `${r1.status} ${code(r1) ?? ""}`);
  const r2 = await create({ ad: "Gece", kanal: "UYGULAMA", clientToken: token });
  const count = await prisma.notificationPreferenceProfile.count({ where: { userId: a.id } });
  check("§5b replay aynı kaydı döner, TEK satır", r2.status === 201 && r2.json?.data?.profil?.id === id && count === 1, `${r2.status} ${count}`);
  const r3 = await create({ ad: "Başka", kanal: "UYGULAMA", clientToken: token });
  check("§5c aynı token başka ad → 409 CLIENT_TOKEN_COLLISION", r3.status === 409 && code(r3) === "CLIENT_TOKEN_COLLISION", `${r3.status} ${code(r3)}`);
  const r4 = await create({ ad: "GECE", kanal: "UYGULAMA" });
  check("§5d aynı ad (harf duyarsız) → 409 NAME_TAKEN", r4.status === 409 && code(r4) === "NOTIFICATION_PREF_PROFILE_NAME_TAKEN", `${r4.status} ${code(r4)}`);
  await apply(a, { kanal: "UYGULAMA", hazir: "HEPSI" });
  const r5 = await apply(a, { kanal: "UYGULAMA", kisisel: id });
  check("§5e kişisel profili uygula → etkin kisisel + FINANS", r5.status === 200 && (r5.json?.data?.profiller?.etkin ?? []).includes(`kisisel:${id}`) && (r5.json?.data?.profiller?.etkin ?? []).includes("hazir:FINANS"), JSON.stringify(r5.json?.data?.profiller?.etkin));
  const r6 = await fx.istek(a.token, "PATCH", `/api/bildirim/tercihler/profiller/${id}`, { ad: "Gece vardiyası" });
  check("§5f yeniden adlandır", r6.status === 200 && r6.json?.data?.profil?.ad === "Gece vardiyası", `${r6.status}`);
  await apply(a, { kanal: "UYGULAMA", hazir: "HEPSI" });
  const r7 = await fx.istek(a.token, "PATCH", `/api/bildirim/tercihler/profiller/${id}`, { kanal: "UYGULAMA", seciminiGuncelle: true });
  check("§5g seçimi güncelle → hepsi açık, kapalı yok", r7.status === 200 && r7.json?.data?.profil?.kapali?.length === 0 && r7.json?.data?.profil?.acik?.length > 0, `${r7.status}`);
  const r8 = await fx.istek(c.token, "POST", "/api/bildirim/tercihler/profil-uygula", { kanal: "UYGULAMA", kisisel: id });
  const r8b = await fx.istek(c.token, "DELETE", `/api/bildirim/tercihler/profiller/${id}`);
  check("§5h başkasının profili → 404 (uygula ve sil)", r8.status === 404 && r8b.status === 404 && code(r8) === "NOTIFICATION_PREF_PROFILE_NOT_FOUND", `${r8.status} ${r8b.status}`);
  const d1 = await fx.istek(a.token, "DELETE", `/api/bildirim/tercihler/profiller/${id}`);
  const row = await prisma.notificationPreferenceProfile.findUnique({ where: { id: id! }, select: { archivedAt: true } });
  check("§5i sil = arşiv (satır durur, archivedAt dolu)", d1.status === 200 && !!row?.archivedAt && (d1.json?.data?.kisisel ?? []).length === 0, `${d1.status}`);
  const d2 = await fx.istek(a.token, "DELETE", `/api/bildirim/tercihler/profiller/${id}`);
  const ap = await apply(a, { kanal: "UYGULAMA", kisisel: id });
  check("§5j ikinci silme ve silinmişi uygulama → 409 ARCHIVED", d2.status === 409 && ap.status === 409 && code(ap) === "NOTIFICATION_PREF_PROFILE_ARCHIVED", `${d2.status} ${ap.status}`);
  const r9 = await create({ ad: "Gece", kanal: "PATRON_PUSH" });
  check("§5k silinen ad yeniden kullanılabilir", r9.status === 201, `${r9.status} ${code(r9) ?? ""}`);
  const audits = await prisma.systemLog.count({ where: { tableName: "NOTIFICATION_PREFERENCE_PROFILE", recordId: id! } });
  check("§5l audit: oluştur + güncelle ×2 + sil", audits >= 4, `${audits}`);
}

async function bolum6(a: FiksturKullanici): Promise<void> {
  console.log("\n=== §6 görme süzgeci + doğrulama ===");
  const g = await fx.istek(a.token, "GET", "/api/bildirim/tercihler/profiller?kanal=PATRON_PUSH");
  const hepsi = (g.json?.data?.hazir ?? []).find((p: any) => p.kod === "HEPSI");
  check("§6a görülemeyen tür hazır listede yok, HEPSI = görünen tür sayısı", g.status === 200 && !hepsi?.acik?.includes(SERTIFIKA) && hepsi?.acik?.length === g.json?.data?.turSayisi, `${hepsi?.acik?.length}/${g.json?.data?.turSayisi}`);
  const b1 = await apply(a, { kanal: "UYGULAMA", hazir: "YOK_BOYLE" });
  const b2 = await apply(a, { kanal: "UYGULAMA", hazir: "HEPSI", kisisel: randomUUID() });
  const b3 = await apply(a, { kanal: "OZET", hazir: "HEPSI" });
  check("§6b tanınmayan hazır 400 · ikisi birden 400 · OZET kanalı 400", b1.status === 400 && code(b1) === "NOTIFICATION_PRESET_UNKNOWN" && b2.status === 400 && b3.status === 400, `${b1.status} ${b2.status} ${b3.status}`);
}

async function bolum7(b: FiksturKullanici, c: FiksturKullanici): Promise<void> {
  console.log("\n=== §7 yönetici hazır kümeleri ===");
  const no = await fx.istek(c.token, "GET", "/api/bildirim/profiller/hazir");
  check("§7a izinsiz → 403", no.status === 403, `${no.status}`);
  const ok = await fx.istek(b.token, "GET", "/api/bildirim/profiller/hazir");
  const items: Array<{ kod: string; turler: string[] }> = ok.json?.data?.items ?? [];
  check("§7b izinli → tam (süzgeçsiz) küme", ok.status === 200 && items.find((i) => i.kod === "HEPSI")?.turler.length === NOTIFICATION_KINDS.length && items.length === PRESET_PROFILES.length);
}

async function bolum8(a: FiksturKullanici): Promise<void> {
  console.log("\n=== §8 bayrak kapalı ===");
  await fx.bayrak(false);
  const g = await fx.istek(a.token, "GET", "/api/bildirim/tercihler/profiller");
  const p = await apply(a, { kanal: "UYGULAMA", hazir: "HEPSI" });
  check("§8 bayrak kapalı → 409 BILDIRIM_KAPALI", g.status === 409 && code(g) === "BILDIRIM_KAPALI" && p.status === 409, `${g.status} ${p.status}`);
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim tercih profilleri ===\n");
  bolum1();
  try {
    await fx.ac();
    await fx.bayrak(true);
    const a = await fx.kullanici("a", ["system:backups", "admin:users", "order:read"]);
    const b = await fx.kullanici("b", ["settings:notifications"]);
    const c = await fx.kullanici("c", ["admin:users"]);
    await bolum2(a);
    await bolum3(a);
    await bolum4(a);
    await bolum5(a, c);
    await bolum6(a);
    await bolum7(b, c);
    await bolum8(a);
  } finally {
    await fx.kapat();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error("❌ beklenmeyen hata:", err);
  await fx.kapat().catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
