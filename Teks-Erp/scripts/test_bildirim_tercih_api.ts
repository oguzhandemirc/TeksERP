// =============================================================================
// BEKÇİ — BİLDİRİM TERCİH UÇLARI (N4-MOTOR, plan §5.6 F4) — HTTP, süreç içi sunucu
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_tercih_api
// =============================================================================
//   §1 kişisel tercih PUT: ⭐ kilitli türde UYGULAMA kapatma 409 `NOTIFICATION_KIND_LOCKED` · görülemeyen tür 400 ·
//      kanal dışı 400 · tanınmayan/beyansız kapsam anahtarı 400 · seyrek yazım (taban çözüme eşit satır yazılmaz)
//   §2 varsayılana dön: önizleme kendi satırlarını listeler, POST yalnız seçileni siler
//   §3 ayarlar: kapalı küme dışı kanal 400, geçerli gövde gidiş-dönüş
//   §4 yönetici: izinsiz 403 · profil POST replay TEK kayıt · kilit önizlemesi DOĞRU kişileri listeler · KILITLI
//      hücre kişinin çözümüne kilit + kaynak olarak yansır · ⭐ üyeli profil arşivi 409 IN_USE · arşiv durum geçişi
//      (ikinci arşiv 409) · eşik doğrulaması 400 · liste `izinsizUyeler` · üye adayları (N4-PROFIL)
//   §5 bayrak kapalı → kişisel ve yönetici uçlar 409 `BILDIRIM_KAPALI`
//
// NEGATİF SONDA (2026-10-25, md5 ile birebir geri alındı): `planPreferenceRows`ta kilit kontrolü kaldırıldı → §1a ❌ (23/1).
// NEGATİF SONDA (N4-PROFIL, 2026-10-25, md5 geri): `archiveProfile`ta üye sayımı kaldırıldı → §4g1 + §4g ❌ (25/2).
// Global ayar yazar (`bildirim.gelenKutusuEnabled`); fikstür bulduğu değere döner. Yalnız kendi kullanıcı/profil satırına dokunur.
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { BildirimFikstur, type FiksturKullanici } from "./lib/bildirim-http-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ek = Date.now().toString(36);
const fx = new BildirimFikstur(`btapi-${ek}`);
const profileCodes: string[] = [];

const YEDEK = "sistem.yedek-basarisiz"; // kilit HER_ZAMAN · system:backups
const ESITLEME = "sistem.esitleme-gecikti"; // kilit YOK · admin:users · varsayılan HERKES
const TERMIN = "siparis.termin-yaklasti"; // kapsam yalnizTakip · order:read
const SERTIFIKA = "kalite.sertifika-suresi-doluyor"; // certificate:read — kişide YOK

const code = (r: { json: any }) => r.json?.error?.details?.code ?? r.json?.details?.code;

async function bolum1(a: FiksturKullanici): Promise<void> {
  console.log("=== §1 kişisel tercih PUT ===");
  const g = await fx.istek(a.token, "GET", "/api/bildirim/tercihler");
  const yedek = g.json?.data?.hucreler?.find((h: any) => h.kind === YEDEK)?.kanallar?.find((k: any) => k.kanal === "UYGULAMA");
  check("§1 GET çözülmüş hücre: kilitli tür kilit=true", g.status === 200 && yedek?.kilit === true, `${g.status} ${JSON.stringify(yedek)}`);
  const put = (tercihler: unknown[]) => fx.istek(a.token, "PUT", "/api/bildirim/tercihler", { tercihler });
  const r1 = await put([{ tur: YEDEK, kanal: "UYGULAMA", acik: false }]);
  check("§1a ⭐ kilitli türde UYGULAMA kapatma → 409 NOTIFICATION_KIND_LOCKED", r1.status === 409 && code(r1) === "NOTIFICATION_KIND_LOCKED", `${r1.status} ${code(r1)}`);
  const r2 = await put([{ tur: SERTIFIKA, kanal: "UYGULAMA", acik: true }]);
  check("§1b görülemeyen tür → 400 NOTIFICATION_KIND_NOT_VISIBLE", r2.status === 400 && code(r2) === "NOTIFICATION_KIND_NOT_VISIBLE", `${r2.status} ${code(r2)}`);
  const r3 = await put([{ tur: TERMIN, kanal: "TABLET_SES", acik: true }]);
  check("§1c türün kanalı olmayan kanal → 400 NOTIFICATION_CHANNEL_INVALID", r3.status === 400 && code(r3) === "NOTIFICATION_CHANNEL_INVALID", `${r3.status} ${code(r3)}`);
  const r4 = await put([{ tur: TERMIN, kanal: "UYGULAMA", acik: true, kapsam: { bilinmeyen: 1 } }]);
  check("§1d tanınmayan kapsam anahtarı → 400 NOTIFICATION_SCOPE_INVALID", r4.status === 400 && code(r4) === "NOTIFICATION_SCOPE_INVALID", `${r4.status} ${code(r4)}`);
  const r5 = await put([{ tur: TERMIN, kanal: "UYGULAMA", acik: true, kapsam: { istasyonlar: "BENIM" } }]);
  check("§1e türde beyan edilmemiş kapsam (istasyon) → 400", r5.status === 400 && code(r5) === "NOTIFICATION_SCOPE_INVALID", `${r5.status} ${code(r5)}`);
  const r6 = await put([
    { tur: TERMIN, kanal: "UYGULAMA", acik: true, kapsam: { yalnizTakip: true } },
    { tur: ESITLEME, kanal: "UYGULAMA", acik: true }, // taban ACIK → yazılmaz
    { tur: ESITLEME, kanal: "OZET", acik: true },
    { tur: YEDEK, kanal: "UYGULAMA", acik: true }, // kilitli açık → anlamsız, yazılmaz
  ]);
  const rows = await prisma.notificationPreference.findMany({ where: { userId: a.id }, select: { kind: true, channel: true, enabled: true, scope: true } });
  const keys = rows.map((r) => `${r.kind}|${r.channel}`).sort();
  check(
    "§1f seyrek yazım: yalnız sapan/kapsamlı satır (taban ve kilitli açık yazılmaz)",
    r6.status === 200 && JSON.stringify(keys) === JSON.stringify([`${ESITLEME}|OZET`, `${TERMIN}|UYGULAMA`].sort()),
    `${r6.status} ${keys.join(",")}`,
  );
  const termin = rows.find((r) => r.kind === TERMIN);
  const sc = termin?.scope as Record<string, unknown> | null | undefined;
  check("§1g kapsam schemaVersion:1 ile saklanır", sc?.schemaVersion === 1 && sc?.yalnizTakip === true && Object.keys(sc).length === 2, JSON.stringify(sc));
  const r7 = await put([{ tur: ESITLEME, kanal: "UYGULAMA", acik: false }]);
  const after = await prisma.notificationPreference.findMany({ where: { userId: a.id }, select: { kind: true, channel: true, enabled: true } });
  check("§1h tam gövde: önceki satırlar değişir (yalnız ESITLEME|UYGULAMA kapalı kalır)", r7.status === 200 && after.length === 1 && after[0].kind === ESITLEME && after[0].enabled === false, JSON.stringify(after));
}

async function bolum2(a: FiksturKullanici): Promise<void> {
  console.log("\n=== §2 varsayılana dön ===");
  const on = await fx.istek(a.token, "POST", "/api/bildirim/tercihler/varsayilana-don/onizleme");
  const satirlar = on.json?.data?.satirlar ?? [];
  check("§2a önizleme kendi satırını listeler (yazmaz)", on.status === 200 && satirlar.length === 1 && satirlar[0].tur === ESITLEME, JSON.stringify(satirlar));
  const yabanci = randomUUID();
  const del = await fx.istek(a.token, "POST", "/api/bildirim/tercihler/varsayilana-don", { ids: [yabanci] });
  check("§2b başkasının/var olmayan id → silinen 0", del.status === 200 && del.json?.data?.silinen === 0, JSON.stringify(del.json?.data));
}

async function bolum3(a: FiksturKullanici): Promise<void> {
  console.log("\n=== §3 ayarlar ===");
  const bad = await fx.istek(a.token, "PUT", "/api/bildirim/ayarlar", { sessizBaslangic: "22:00", sessizBitis: "07:00", sessizKanallar: ["UYGULAMA"], ozetSaati: 8, ses: true });
  check("§3a sessiz saat UYGULAMA'yı susturamaz → 400", bad.status === 400, `${bad.status}`);
  const body = { sessizBaslangic: "22:00", sessizBitis: "07:00", sessizKanallar: ["MASAUSTU"], ozetSaati: 8, ses: false };
  const ok = await fx.istek(a.token, "PUT", "/api/bildirim/ayarlar", body);
  const get = await fx.istek(a.token, "GET", "/api/bildirim/ayarlar");
  check("§3b geçerli gövde gidiş-dönüş", ok.status === 200 && JSON.stringify(get.json?.data) === JSON.stringify(body), JSON.stringify(get.json?.data));
}

async function bolum4(a: FiksturKullanici, b: FiksturKullanici, c: FiksturKullanici): Promise<void> {
  console.log("\n=== §4 yönetici uçları ===");
  const kod = `BT${ek}`.toUpperCase().slice(0, 40);
  profileCodes.push(kod);
  const yetkisiz = await fx.istek(a.token, "POST", "/api/bildirim/profiller", { kod, ad: "x" });
  check("§4a izinsiz profil POST → 403", yetkisiz.status === 403, `${yetkisiz.status}`);
  const token = randomUUID();
  const p1 = await fx.istek(b.token, "POST", "/api/bildirim/profiller", { kod, ad: "Vardiya amirleri", clientToken: token });
  const p2 = await fx.istek(b.token, "POST", "/api/bildirim/profiller", { kod, ad: "Vardiya amirleri", clientToken: token });
  const n = await prisma.notificationProfile.count({ where: { code: kod } });
  const pid = p1.json?.data?.id as string;
  check("§4b profil POST replay → aynı kayıt, TEK satır", p1.status === 201 && p2.status === 201 && p2.json?.data?.id === pid && n === 1, `${p1.status}/${p2.status} n=${n}`);
  const uy = await fx.istek(b.token, "PUT", `/api/bildirim/profiller/${pid}/uyeler`, { userIds: [a.id, c.id] });
  check("§4c üye kümesi yazılır", uy.status === 200 && uy.json?.data?.uyeler?.length === 2, `${uy.status}`);
  const hucreler = [{ tur: ESITLEME, durum: "KILITLI" }];
  const on = await fx.istek(b.token, "POST", `/api/bildirim/profiller/${pid}/kilit-onizleme`, { hucreler });
  const etk = (on.json?.data?.etkilenen ?? []).map((e: any) => e.userId);
  check("§4d kilit önizlemesi: yalnız kendi UYGULAMA'sını kapatmış üye (A var, C yok)", on.status === 200 && etk.length === 1 && etk[0] === a.id, JSON.stringify(etk));
  const hc = await fx.istek(b.token, "PUT", `/api/bildirim/profiller/${pid}/hucreler`, { hucreler });
  const g = await fx.istek(a.token, "GET", "/api/bildirim/tercihler");
  const es = g.json?.data?.hucreler?.find((h: any) => h.kind === ESITLEME)?.kanallar?.find((k: any) => k.kanal === "UYGULAMA");
  check(
    "§4e KILITLI hücre kişinin kapatmasını ezer: ACIK + kilit + kaynak profil",
    hc.status === 200 && es?.durum === "ACIK" && es?.kilit === true && es?.kaynak === "profil:Vardiya amirleri",
    JSON.stringify(es),
  );
  const tanimsiz = await fx.istek(b.token, "PUT", `/api/bildirim/profiller/${pid}/hucreler`, { hucreler: [{ tur: "yok.boyle", durum: "ACIK" }] });
  check("§4f tanınmayan tür hücresi → 400", tanimsiz.status === 400 && code(tanimsiz) === "NOTIFICATION_KIND_UNKNOWN", `${tanimsiz.status} ${code(tanimsiz)}`);
  const liste = await fx.istek(b.token, "GET", "/api/bildirim/profiller");
  const satir = (liste.json?.data?.items ?? []).find((p: any) => p.id === pid);
  check("§4j liste `izinsizUyeler`: sertifika türünü göremeyen üye sayılır (bilgi)", liste.status === 200 && (satir?.izinsizUyeler?.[SERTIFIKA] ?? 0) >= 1, JSON.stringify(satir?.izinsizUyeler));
  const aday = await fx.istek(b.token, "GET", "/api/bildirim/profiller/aday-kullanicilar");
  const adayA = await fx.istek(a.token, "GET", "/api/bildirim/profiller/aday-kullanicilar");
  check("§4k üye adayları yönetici uçta (A listede); izinsiz 403", aday.status === 200 && (aday.json?.data?.items ?? []).some((u: any) => u.id === a.id) && adayA.status === 403, `${aday.status}/${adayA.status}`);
  const dolu = await fx.istek(b.token, "DELETE", `/api/bildirim/profiller/${pid}`);
  const durum = await prisma.notificationProfile.findUnique({ where: { id: pid }, select: { archivedAt: true } });
  check("§4g1 ⭐ üyesi olan profil arşivlenemez → 409 NOTIFICATION_PROFILE_IN_USE (canlı referans), satır arşivsiz", dolu.status === 409 && code(dolu) === "NOTIFICATION_PROFILE_IN_USE" && (dolu.json?.error?.details ?? dolu.json?.details)?.uyeSayisi === 2 && durum?.archivedAt === null, `${dolu.status} ${code(dolu)}`);
  await fx.istek(b.token, "PUT", `/api/bildirim/profiller/${pid}/uyeler`, { userIds: [] });
  const ar1 = await fx.istek(b.token, "DELETE", `/api/bildirim/profiller/${pid}`);
  const ar2 = await fx.istek(b.token, "DELETE", `/api/bildirim/profiller/${pid}`);
  check("§4g arşiv durum geçişi (üyeler çıkarıldıktan sonra); ikinci arşiv 409", ar1.status === 200 && !!ar1.json?.data?.arsivlendi && ar2.status === 409 && code(ar2) === "NOTIFICATION_PROFILE_ARCHIVED", `${ar1.status}/${ar2.status}`);
  const g2 = await fx.istek(a.token, "GET", "/api/bildirim/tercihler");
  const es2 = g2.json?.data?.hucreler?.find((h: any) => h.kind === ESITLEME)?.kanallar?.find((k: any) => k.kanal === "UYGULAMA");
  check("§4h arşivli profil çözüme katılmaz (kişinin kapatması geri gelir)", es2?.durum === "KAPALI" && es2?.kilit === false, JSON.stringify(es2));
  const esik = await fx.istek(b.token, "PUT", "/api/bildirim/fabrika-varsayilani", { turler: [{ tur: "fason.donus-gecikti", durum: "MIRAS", esikler: { gun: "çok" } }] });
  check("§4i geçersiz eşik → 400 NOTIFICATION_PARAMS_INVALID", esik.status === 400 && code(esik) === "NOTIFICATION_PARAMS_INVALID", `${esik.status} ${code(esik)}`);
  const fa = await fx.istek(a.token, "GET", "/api/bildirim/fabrika-varsayilani");
  check("§4j izinsiz fabrika varsayılanı → 403", fa.status === 403, `${fa.status}`);
}

async function bolum5(a: FiksturKullanici, b: FiksturKullanici): Promise<void> {
  console.log("\n=== §5 bayrak kapalı ===");
  await fx.bayrak(false);
  const r1 = await fx.istek(a.token, "GET", "/api/bildirim/tercihler");
  const r2 = await fx.istek(b.token, "GET", "/api/bildirim/profiller");
  check("§5 bayrak kapalı → kişisel ve yönetici uç 409 BILDIRIM_KAPALI", r1.status === 409 && code(r1) === "BILDIRIM_KAPALI" && r2.status === 409, `${r1.status}/${r2.status}`);
  await fx.bayrak(true);
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim tercih uçları (F4) ===\n");
  try {
    await fx.ac();
    await fx.bayrak(true);
    const a = await fx.kullanici("a", ["system:backups", "admin:users", "order:read"]);
    const b = await fx.kullanici("b", ["settings:notifications"]);
    const c = await fx.kullanici("c", ["admin:users"]);
    await bolum1(a);
    await bolum2(a);
    await bolum3(a);
    await bolum4(a, b, c);
    await bolum5(a, b);
  } finally {
    // Kendi profilleri (iş anahtarı: koşuma özgü kod); hücre/üye satırları cascade.
    if (profileCodes.length) await prisma.notificationProfile.deleteMany({ where: { code: { in: profileCodes } } });
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
