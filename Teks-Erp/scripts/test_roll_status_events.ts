// =============================================================================
// BEKÇİ — TOP DURUM DEFTERİ (roll_status_events, K-A3 2026-09-25)
// Çalıştır: npx tsx scripts/run-all-tests.ts roll_status_events
// =============================================================================
// Defteri DB trigger'ı yazar (`rolls_write_status_event`): topun her durum geçişi bir
// satır. Operatör aktivitesindeki iptaller buradan okunur (audit yalnız ayak izidir).
//   §1 nesneler var · §2 doğuş · §3 geçiş (durum dışı dokunuş satır DOĞURMAZ) · §4 iptal/
//   fire aktörü · §5 geri alma = karşı kayıt, ileri satır değişmez · §6 mühür (doğrudan
//   UPDATE/DELETE RED) · §7 top silinince kaskad (bekçi temizlikleri) · §8 statik: kodda
//   bu deftere yazan 0 (1e şartı) · §9 göç script'i uçtan uca, üç geçiş ayrı (① kolonlar ·
//   ② audit'in EN SON CANCELLED satırı, sıcak + arşiv · ③ tambur geri alma parçasında
//   ebeveynin EN SON TAMBUR_UNDO_* satırı) + kaynak CHECK'i (kuru → uygula → 0) ·
//   §10 aktörsüz (defter sonrası) iptal satırı sayısı basılır.
//
// NEGATİF SONDA ✓B3 (koşuldu 2026-09-25, izole ağaç, geri alındı):
//   S1 trigger DISABLE → §2/§3/§4/§5 ❌ (satır doğmadı) · S2 mühür fonksiyonunda UPDATE
//   dalı silindi → §6a ❌ · S3 src'ye `prisma.rollStatusEvent.deleteMany` eklendi → §8 ❌.
//   S4 (K-A3b) ② geçişte sıralama ASC'ye çevrildi (en ESKİ iptal) → §9b2 ❌, geri alındı.
// =============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { cocukOrtami, hedefDbAdi } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";

const KOK = join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const olaylar = (rollId: string) =>
  prisma.rollStatusEvent.findMany({ where: { rollId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

/** Reddedilirse trigger'ın mesajı, geçerse "". */
async function reddedilir(sql: string): Promise<string> {
  try {
    await prisma.$executeRawUnsafe(sql);
    return "";
  } catch (e) {
    const m = String((e as Error).message ?? e);
    return m.match(/Defter satırı[^.]*\./)?.[0] ?? m.match(/violates check constraint "[^"]+"/)?.[0] ?? m;
  }
}

/** Kodda bu deftere yazan yer — Prisma CUD ya da ham SQL. SAF. */
export function defterYazimlari(kaynak: string): string[] {
  const temiz = kaynak.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of temiz.matchAll(/\brollStatusEvent\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)) out.push(m[1]!);
  // Tablo boşaltma ifadesi desende BİLEREK yok (kapsam sınırı): kelimesi bu dosyada
  // geçerse test_script_guards dosyayı yıkıcı betik sayar.
  for (const m of temiz.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?roll_status_events"?/gi)) out.push(m[1]!.toUpperCase());
  return out;
}

function kosScript(args: string[]): { kod: number; cikti: string } {
  const r = spawnSync("npx", ["tsx", "scripts/backfill_roll_status_events.ts", ...args], {
    cwd: KOK, env: cocukOrtami(), encoding: "utf8", timeout: 120_000,
  });
  return { kod: r.status ?? -1, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

async function main(): Promise<void> {
  console.log("=== TOP DURUM DEFTERİ ===\n");
  const ts = Date.now();
  const rollIds: string[] = [];
  let tetikKapali = false;
  const logIds: string[] = [];
  const arsivIds: string[] = [];
  // Fikstür kendi kurulur (ortama yaslanmaz): reçetenin test yöneticisi + koşuma özgü ürün.
  const user = await ensureTestAdmin();
  const item = await prisma.item.create({
    data: { code: `TEST-RSE-${ts}`, name: `TEST-RSE ${ts} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const yeniTop = async (ek: string) => {
    const r = await prisma.roll.create({
      data: { barcode: `TEST-RSE-${ek}-${ts}`, itemId: item.id, status: RollStatus.STOCK, initialQty: 10, currentQty: 10 },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };

  try {
    // §1
    const tg = await prisma.$queryRaw<Array<{ tgname: string; tgenabled: string }>>`
      SELECT tgname, tgenabled::text FROM pg_trigger WHERE tgname IN ('rolls_write_status_event', 'roll_status_events_block_tamper')`;
    check("§1 iki trigger var ve etkin", tg.length === 2 && tg.every((t) => t.tgenabled === "O"),
      tg.map((t) => `${t.tgname}:${t.tgenabled}`).join(" · "));

    // §2 doğuş
    const a = await yeniTop("A");
    const d = await olaylar(a);
    check("§2 doğuş: tek satır, from=null → STOCK, aktörsüz",
      d.length === 1 && d[0]!.fromStatus === null && d[0]!.toStatus === RollStatus.STOCK && d[0]!.actorId === null && !d[0]!.preEpoch,
      JSON.stringify(d.map((x) => [x.fromStatus, x.toStatus])));

    // §3 geçiş + durum dışı dokunuş
    await prisma.roll.update({ where: { id: a }, data: { status: RollStatus.IN_PRODUCTION } });
    await prisma.roll.update({ where: { id: a }, data: { currentQty: 9 } });
    const g = await olaylar(a);
    check("§3 durum geçişi bir satır, durum dışı güncelleme satır doğurmaz",
      g.length === 2 && g[1]!.fromStatus === RollStatus.STOCK && g[1]!.toStatus === RollStatus.IN_PRODUCTION,
      `${g.length} satır`);

    // §4 iptal ve fire aktörü
    await prisma.roll.update({ where: { id: a }, data: { status: RollStatus.CANCELLED, cancelledAt: new Date(), cancelledById: user.id } });
    const b = await yeniTop("B");
    await prisma.roll.update({ where: { id: b }, data: { status: RollStatus.SCRAP, cancelledAt: new Date(), cancelledById: user.id } });
    const iptal = (await olaylar(a)).at(-1);
    const fire = (await olaylar(b)).at(-1);
    check("§4 iptal ve fire satırının aktörü geçiş anındaki cancelledById",
      iptal?.toStatus === RollStatus.CANCELLED && iptal.actorId === user.id && fire?.toStatus === RollStatus.SCRAP && fire.actorId === user.id);

    // §5 geri alma = karşı kayıt (restoreCancelledRoll kolonları null'lar; defter korur)
    await prisma.roll.update({ where: { id: a }, data: { status: RollStatus.STOCK, cancelledAt: null, cancelledById: null } });
    const k = await olaylar(a);
    const ileri = k.find((x) => x.id === iptal?.id);
    check("§5 geri alma yeni satır (CANCELLED → STOCK), iptal satırı aktörüyle DURUYOR",
      k.length === 4 && k[3]!.fromStatus === RollStatus.CANCELLED && k[3]!.toStatus === RollStatus.STOCK &&
        ileri?.actorId === user.id && ileri.toStatus === RollStatus.CANCELLED, `${k.length} satır`);

    // §6 mühür
    const upd = await reddedilir(`UPDATE roll_status_events SET "toStatus" = 'STOCK' WHERE "rollId" = '${a}'`);
    const del = await reddedilir(`DELETE FROM roll_status_events WHERE "rollId" = '${a}'`);
    check("§6a doğrudan UPDATE reddedilir", upd.includes("değiştirilemez"), upd || "GEÇTİ");
    check("§6b doğrudan DELETE reddedilir", del.includes("silinemez"), del || "GEÇTİ");
    check("§6c reddedilen yazım satırı değiştirmedi", (await olaylar(a)).length === 4);

    // §7 kaskad
    const c = await yeniTop("C");
    await prisma.roll.delete({ where: { id: c } });
    check("§7 top silinince (bekçi temizliği) satırları kaskadla gider", (await olaylar(c)).length === 0);

    // §8 statik — kodda yazan 0; tek yazar trigger, tek istisna beyanlı göç script'i
    const yazanlar: string[] = [];
    for (const f of walkTs(join(KOK, "src"))) {
      const y = defterYazimlari(readFileSync(f, "utf8"));
      if (y.length) yazanlar.push(`${relative(KOK, f)} (${y.join(",")})`);
    }
    check("§8 ⭐ src'de roll_status_events'e yazan/silen kod YOK (yazar DB trigger'ı)", yazanlar.length === 0, yazanlar.join(" · "));
    check("§8s sonda: yazım deseni tanınır, yorum sayılmaz",
      defterYazimlari("await tx.rollStatusEvent.deleteMany({});").join() === "deleteMany" &&
        defterYazimlari("q`DELETE FROM roll_status_events`").join() === "DELETE FROM" &&
        defterYazimlari("// prisma.rollStatusEvent.create()").length === 0 &&
        defterYazimlari("prisma.rollStatusEvent.findMany({})").length === 0);

    // §9 göç script'i: trigger'sız doğmuş eski iptaller (defter öncesi) → kuru → uygula → 0.
    //   ESKI — kolonlar dolu (① ROLL_COLUMNS) · IKI — kolonda aktör yok, audit'te iki CANCELLED
    //   satırı (iptal → geri alma → yeniden iptal; ② AUDIT, EN SONUNCU seçilmeli) · ARS — yalnız
    //   arşivde izi var (② AUDIT, arşiv kolu).
    const eski = `TEST-RSE-ESKI-${ts}`;
    const iki = `TEST-RSE-IKI-${ts}`;
    const ars = `TEST-RSE-ARS-${ts}`;
    const eskiAn = new Date(Date.now() - 86_400_000);
    const ilkIptal = new Date(Date.now() - 3 * 86_400_000);
    const geriAlma = new Date(Date.now() - 2 * 86_400_000);
    const sonIptal = new Date(Date.now() - 86_400_000 + 60_000);
    const arsivAn = new Date(Date.now() - 200 * 86_400_000);
    // ⚠️ Aynı tx'te olamaz (rolls'un ertelenmiş FK kontrolleri "pending trigger events"):
    // kapat → yarat → AÇ ayrı ifadeler; açma `finally`de de koşar (tetik kapalı kalmasın).
    await prisma.$executeRawUnsafe(`ALTER TABLE rolls DISABLE TRIGGER rolls_write_status_event`);
    tetikKapali = true;
    const eskiTop = (b: string, ek: object) => prisma.roll.create({
      data: { barcode: b, itemId: item.id, status: RollStatus.CANCELLED, initialQty: 5, currentQty: 5,
        preCancelStatus: RollStatus.STOCK, ...ek }, select: { id: true } });
    const ebeveynId = (await prisma.roll.create({
      data: { barcode: `TEST-RSE-EB-${ts}`, itemId: item.id, status: RollStatus.STOCK, initialQty: 5, currentQty: 5 },
      select: { id: true } })).id;
    const eskiId = (await eskiTop(eski, { cancelledAt: eskiAn, cancelledById: user.id })).id;
    const ikiId = (await eskiTop(iki, {})).id;
    const arsId = (await eskiTop(ars, { preCancelStatus: null })).id;
    const parca = `TEST-RSE-PARCA-${ts}`;
    const parcaId = (await eskiTop(parca, { preCancelStatus: null, parentRollId: ebeveynId })).id;
    await prisma.$executeRawUnsafe(`ALTER TABLE rolls ENABLE TRIGGER rolls_write_status_event`);
    tetikKapali = false;
    rollIds.push(parcaId, eskiId, ikiId, arsId, ebeveynId);
    // ③ ebeveynin izi: eski TAMBUR_UNDO_SINGLE · yeni TAMBUR_UNDO_FULL (seçilmeli) · daha yeni ama
    // TAMBUR_UNDO olmayan bir olay (seçilmemeli).
    const undoEski = new Date(Date.now() - 5 * 86_400_000);
    const undoYeni = new Date(Date.now() - 4 * 86_400_000);
    for (const [at, newData] of [
      [undoEski, { event: "TAMBUR_UNDO_SINGLE", cancelledChildId: parcaId }],
      [undoYeni, { event: "TAMBUR_UNDO_FULL", cancelledChildIds: [parcaId] }],
      [new Date(Date.now() - 3.5 * 86_400_000), { event: "TAMBUR_FINALIZE", cancelledChildId: parcaId }],
    ] as const) {
      const l = await prisma.systemLog.create({
        data: { userId: user.id, category: "DOMAIN", action: "UPDATE", tableName: "ROLL", recordId: ebeveynId,
          newData, createdAt: at },
        select: { id: true } });
      logIds.push(l.id);
    }
    for (const [at, status] of [[ilkIptal, "CANCELLED"], [geriAlma, "STOCK"], [sonIptal, "CANCELLED"]] as const) {
      const l = await prisma.systemLog.create({
        data: { userId: user.id, category: "DOMAIN", action: "UPDATE", tableName: "ROLL", recordId: ikiId,
          oldData: { status: status === "CANCELLED" ? "STOCK" : "CANCELLED" }, newData: { status }, createdAt: at },
        select: { id: true } });
      logIds.push(l.id);
    }
    const arsivId = crypto.randomUUID();
    await prisma.systemLogArchive.create({
      data: { id: arsivId, userId: user.id, category: "DOMAIN", action: "UPDATE", tableName: "ROLL", recordId: arsId,
        oldData: { status: "A1_STOCK" }, newData: { status: "CANCELLED" }, createdAt: arsivAn, updatedAt: arsivAn } });
    arsivIds.push(arsivId);

    const kuru = kosScript([]);
    const n = Number(kuru.cikti.match(/Doldurulacak iptal: (\d+) top/)?.[1] ?? NaN);
    const ikiBolum = (kuru.cikti.split("② audit")[1] ?? "").split("③ ebeveyn")[0] ?? "";
    const ucBolum = kuru.cikti.split("③ ebeveyn")[1] ?? "";
    check("§9a kuru koşum yazmaz; ①, ② ve ③ AYRI basılır, fikstürler doğru geçişte",
      kuru.kod === 0 && n >= 4 && /① topun iptal kolonlarından \(ROLL_COLUMNS\): \d+ top/.test(kuru.cikti) &&
        /② audit'in son CANCELLED satırından \(AUDIT\): \d+ top/.test(kuru.cikti) &&
        /③ ebeveynin TAMBUR_UNDO_\* audit satırından \(AUDIT_EBEVEYN\): \d+ top/.test(kuru.cikti) &&
        /\(① \d+ \+ ② \d+ \+ ③ \d+\)/.test(kuru.cikti) &&
        ikiBolum.includes(iki) && ikiBolum.includes(ars) && !ikiBolum.includes(eski) && !ikiBolum.includes(parca) &&
        ucBolum.includes(parca) && !ucBolum.includes(iki) && (await olaylar(eskiId)).length === 0,
      `çıkış ${kuru.kod} · aday ${n}`);
    const uygula = kosScript(["--apply", `--onay=${n}`, `--hedef=${hedefDbAdi()}`]);
    const ev = await olaylar(eskiId);
    check("§9b ① preEpoch satırı, aktör + an topun iptal kolonlarından, kaynak ROLL_COLUMNS",
      uygula.kod === 0 && ev.length === 1 && ev[0]!.preEpoch && ev[0]!.preEpochSource === "ROLL_COLUMNS" && ev[0]!.actorId === user.id &&
        ev[0]!.fromStatus === RollStatus.STOCK && ev[0]!.createdAt.getTime() === eskiAn.getTime(),
      `çıkış ${uygula.kod} · ${ev.length} satır`);
    const evIki = await olaylar(ikiId);
    check("§9b2 ⭐ ② iki kez iptal edilmiş topta EN SON iptalin anı + aktörü, kaynak AUDIT",
      evIki.length === 1 && evIki[0]!.preEpochSource === "AUDIT" && evIki[0]!.actorId === user.id &&
        evIki[0]!.createdAt.getTime() === sonIptal.getTime() && evIki[0]!.fromStatus === RollStatus.STOCK,
      evIki.map((x) => `${x.createdAt.toISOString()}:${x.preEpochSource}`).join(",") || "satır yok");
    const evArs = await olaylar(arsId);
    check("§9b3 ② yalnız arşivde izi olan iptal de aktarılır (fromStatus oldData'dan)",
      evArs.length === 1 && evArs[0]!.preEpochSource === "AUDIT" && evArs[0]!.createdAt.getTime() === arsivAn.getTime() &&
        evArs[0]!.fromStatus === RollStatus.A1_STOCK, evArs.map((x) => `${x.fromStatus}:${x.preEpochSource}`).join(",") || "satır yok");
    const evParca = await olaylar(parcaId);
    check("§9b4 ⭐ ③ tambur geri alma parçasında ebeveynin EN SON TAMBUR_UNDO_* satırı (başka olay seçilmez), kaynak AUDIT",
      evParca.length === 1 && evParca[0]!.preEpochSource === "AUDIT" && evParca[0]!.actorId === user.id &&
        evParca[0]!.createdAt.getTime() === undoYeni.getTime() && evParca[0]!.fromStatus === null,
      evParca.map((x) => `${x.createdAt.toISOString()}:${x.preEpochSource}`).join(",") || "satır yok");
    const ikinci = kosScript([]);
    check("§9c ikinci kuru koşum 0 aday (idempotent)", /Doldurulacak iptal: 0 top/.test(ikinci.cikti));
    const yanlisHedef = kosScript(["--apply", "--onay=0", "--hedef=baska_db"]);
    check("§9d yanlış --hedef yazmaz (çıkış ≠ 0)", yanlisHedef.kod !== 0 && yanlisHedef.cikti.includes("Yazma YOK"));
    const kaynaksizRed = await reddedilir(
      `INSERT INTO roll_status_events ("rollId","toStatus","preEpoch","preEpochSource") VALUES ('${eskiId}','CANCELLED',false,'AUDIT')`);
    check("§9e CHECK: kaynak yalnız preEpoch satırında", kaynaksizRed.includes("pre_epoch_source_check"), kaynaksizRed.slice(0, 80) || "GEÇTİ");

    // §10 bilgi
    const aktorsuz = await prisma.rollStatusEvent.count({ where: { toStatus: RollStatus.CANCELLED, actorId: null, preEpoch: false } });
    console.log(`   ⓘ aktörsüz iptal satırı (defter sonrası): ${aktorsuz}`);
  } finally {
    if (tetikKapali) await prisma.$executeRawUnsafe(`ALTER TABLE rolls ENABLE TRIGGER rolls_write_status_event`).catch(() => {});
    // Test DB'de audit koruması (teks.audit_guard) kapalı; açıksa satır kalır, zararsız.
    await prisma.systemLog.deleteMany({ where: { id: { in: logIds } } }).catch(() => {});
    await prisma.systemLogArchive.deleteMany({ where: { id: { in: arsivIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => { console.error("Beklenmeyen hata:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
