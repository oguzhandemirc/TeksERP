// =============================================================================
// BEKÇİ — HIZLI SEBEP (E7, 2026-09-18): `quickPick` KOLON DEĞİL, sıralamadan türetilir — duruş kataloğunun ilk 4 aktifi
// =============================================================================
//   §1 saf `markQuickPicks`: MACHINE_STOP aktif ilk 4 true, 5. false; pasif satır sayıma girmez ve hiç true olmaz;
//      öteki kind (WARP_RETURN) hiç true olmaz.
//   §2 liste ucu: `list({kind: MACHINE_STOP})` işareti taşır; `includeInactive` işareti DEĞİŞTİRMEZ (pasif sayılmaz);
//      `reorder` ile 5. sıraya alınan sebep işareti KAYBEDER, öne alınan KAZANIR (fabrika sırayla seçer, ayar yok).
//   §2e (2026-11-09) `stationKind` süzgeci verilince işaret SÜZÜLMÜŞ listede türer (ilk 4 aktif); kapsam ayrıntısı
//      `test_durus_istasyon_kapsami` §6.
//   §2f (2026-11-09) reorder TAM permütasyon (pasif dahil, ters sıra): yanıt gönderilen sırada, DB sortOrder = indeks.
// Negatif sondalar (kırmızı görüldü): pasif süzgeci kalkınca §1b ❌ · `QUICK_PICK_KINDS` boşalınca §1a/§2a ❌ ·
//   `list` `markQuickPicks` çağırmayınca §2a ❌ · `reorder` update'inden `sortOrder: i` düşünce §2d/§2f ❌ (2026-11-09).
// ⚠️ DB'ye YAZAR (kendi TEST-QP- preset'leri; sıralamayı fotoğraflayıp geri koyar) → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { MachineStopLossClass, ReasonPresetKind, StationKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { QUICK_PICK_COUNT } from "../src/constants/reason-presets";
import { ReasonPresetService, markQuickPicks } from "../src/services/reason-preset.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const TAG = `TEST-QP-${Date.now().toString(36)}`;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(1); }
  console.log("\n=== Hızlı sebep (quickPick) — sıralamadan türetilir ===\n");

  // ── §1 saf ─────────────────────────────────────────────────────────────
  const mk = (kind: ReasonPresetKind, isActive: boolean, i: number) => ({ kind, isActive, code: `${kind}-${i}` });
  const rows = [mk("MACHINE_STOP", true, 1), mk("MACHINE_STOP", false, 2), mk("MACHINE_STOP", true, 3), mk("MACHINE_STOP", true, 4), mk("MACHINE_STOP", true, 5), mk("MACHINE_STOP", true, 6), mk("WARP_RETURN", true, 7)];
  const marked = markQuickPicks(rows);
  const pick = (code: string) => marked.find((r) => r.code === code)?.quickPick;
  check(`§1a MACHINE_STOP aktif ilk ${QUICK_PICK_COUNT} true, sonraki false`, pick("MACHINE_STOP-1") === true && pick("MACHINE_STOP-3") === true && pick("MACHINE_STOP-4") === true && pick("MACHINE_STOP-5") === true && pick("MACHINE_STOP-6") === false, marked.map((r) => `${r.code}:${r.quickPick ? 1 : 0}`).join(" "));
  check("§1b ⭐ pasif satır sayıma girmez ve hiç true olmaz (2. sıradaki pasif atlandı, 5. sıradaki aktif girdi)", pick("MACHINE_STOP-2") === false && pick("MACHINE_STOP-5") === true);
  check("§1c öteki kind (WARP_RETURN) hiç işaret almaz", pick("WARP_RETURN-7") === false);

  // ── §2 liste + reorder ─────────────────────────────────────────────────
  const foto = await prisma.reasonPreset.findMany({ where: { kind: ReasonPresetKind.MACHINE_STOP }, select: { id: true, sortOrder: true } });
  const createdIds: string[] = [];
  try {
    const before = await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP });
    check("§2a liste ucu işareti taşır: aktif ilk 4 true, gerisi false", before.length >= 5 && before.slice(0, QUICK_PICK_COUNT).every((r) => r.quickPick) && before.slice(QUICK_PICK_COUNT).every((r) => !r.quickPick), `${before.length} satır`);
    const withInactive = await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP, includeInactive: true });
    const activeMarks = withInactive.filter((r) => r.isActive).map((r) => r.quickPick);
    check("§2b includeInactive işareti değiştirmez: pasifler false, aktiflerin işareti aynı", withInactive.filter((r) => !r.isActive).every((r) => !r.quickPick) && JSON.stringify(activeMarks) === JSON.stringify(before.map((r) => r.quickPick)));
    // Yeni sebep sona doğar (işaretsiz); öne alınca işaret KAZANIR, eski 4. sıra KAYBEDER.
    const yeni = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `${TAG} hızlı`, stopLossClass: MachineStopLossClass.UNPLANNED });
    createdIds.push(yeni.id);
    const afterCreate = await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP });
    check("§2c yeni sebep sona doğar → işaretsiz", afterCreate.find((r) => r.id === yeni.id)?.quickPick === false);
    const ids = afterCreate.map((r) => r.id);
    // Servisin liste sırasıyla okunur: sırasız findMany fiziksel sırayı verir, "eski 4. sıradaki" iddiasını kaydırır.
    const allIds = (await prisma.reasonPreset.findMany({ where: { kind: ReasonPresetKind.MACHINE_STOP }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } })).map((r) => r.id);
    const reordered = [yeni.id, ...allIds.filter((id) => id !== yeni.id)];
    await ReasonPresetService.reorder(ReasonPresetKind.MACHINE_STOP, reordered);
    const afterReorder = await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP });
    const fourthBefore = ids[QUICK_PICK_COUNT - 1]!;
    check("§2d ⭐ öne alınan sebep işaret KAZANIR, eski 4. sıradaki KAYBEDER — fabrika 'hızlı dörtlüyü' sırayla seçer", afterReorder[0]?.id === yeni.id && afterReorder[0]?.quickPick === true && afterReorder.find((r) => r.id === fourthBefore)?.quickPick === false);
    const scoped = await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP, stationKind: StationKind.TAMBUR });
    check("§2e süzülmüş liste (stationKind=TAMBUR): işaret süzülmüşün ilk 4 aktifinde", scoped.length >= QUICK_PICK_COUNT && scoped.slice(0, QUICK_PICK_COUNT).every((r) => r.quickPick) && scoped.slice(QUICK_PICK_COUNT).every((r) => !r.quickPick), `${scoped.length} satır`);
    // §2f TAM permütasyon (pasif dahil, ters sıra): yanıt gönderilen sırayla AYNI, DB'de her satırın sortOrder'ı = indeksi.
    // Demo raporu (2026-11-09) "200 ama sıra değişmiyor" — denetimde istemci ids'i ESKİ sırada göndermişti (audit `order`).
    const pasif = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `${TAG} pasif`, stopLossClass: MachineStopLossClass.UNPLANNED });
    createdIds.push(pasif.id);
    await ReasonPresetService.update(pasif.id, { isActive: false });
    const tum = (await ReasonPresetService.list({ kind: ReasonPresetKind.MACHINE_STOP, includeInactive: true })).map((r) => r.id);
    const ters = [...tum].reverse();
    const yanit = (await ReasonPresetService.reorder(ReasonPresetKind.MACHINE_STOP, ters)).map((r) => r.id);
    const db = new Map((await prisma.reasonPreset.findMany({ where: { kind: ReasonPresetKind.MACHINE_STOP }, select: { id: true, sortOrder: true } })).map((r) => [r.id, r.sortOrder]));
    check("§2f ⭐ reorder tam permütasyon (pasif dahil): yanıt gönderilen sırada, DB sortOrder = indeks", tum.length >= 6 && JSON.stringify(yanit) === JSON.stringify(ters) && ters.every((id, i) => db.get(id) === i), `${tum.length} satır`);
  } finally {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: createdIds } } }).catch(() => undefined);
    await prisma.reasonPreset.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined);
    for (const f of foto) await prisma.reasonPreset.update({ where: { id: f.id }, data: { sortOrder: f.sortOrder } }).catch(() => undefined);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("❌ bekçi çöktü:", e);
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
