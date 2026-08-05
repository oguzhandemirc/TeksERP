// =============================================================================
// Test: Ham giriş mükerrer top tuzağı (kk1.duplicateGuardEnabled)
// =============================================================================
// SAHA VAKASI (2026-08-03): sunucu restart edildi; ham giriş personeli etiket
// çıkmayınca "Kaydet ve Etiket Bas"a defalarca bastı. Mobil her basışta YENİ bir
// `clientToken` ürettiği için backend'in idempotency koruması hiç devreye
// giremedi ve TEK fiziksel top için N ayrı stok kaydı doğdu.
//
// Asıl düzeltme istemcidedir (mobil/src/offline/entryAttempt.ts). Bu tuzak
// İSTEMCİYE GÜVENMEYEN ikinci hattır: farklı cihaz, uygulama yeniden kurulumu ya
// da doğrudan API çağrısı da yakalanır.
//
// Doğrulananlar:
//   1. Bayrak KAPALI (varsayılan) → hiçbir davranış değişmez (deploy güvenli)
//   2. Bayrak AÇIK + 90 sn içinde birebir aynı giriş → 409 POSSIBLE_DUPLICATE
//   3. `confirmDuplicate` (opts.duplicateGuard.confirmed) → geçer
//   4. Farklı metraj → engel yok (yanlış-pozitif değil)
//   5. ⭐ DAHİLİ ÇAĞRI REGRESYONU — `opts.duplicateGuard` VERİLMEZSE tuzak
//      ATLANIR. `createInitialEntry`'nin dahili çağıranları var
//      (tambur-manual.service ×2) ve onlar programatik olarak arka arkaya
//      birebir aynı topu üretebilir; koşulsuz tuzak o akışları KIRARDI.
//   6. Farklı operatör → engel yok (iki kişinin aynı anda benzer top girmesi meşru)
//   7. AYNI clientToken → tuzağa değil idempotent yola düşer (cached top döner)
//   8. İptal edilmiş (CANCELLED) ikiz → engel yok (yeniden giriş düzeltmedir)
//
// ─────────────────────────────────────────────────────────────────────────────
// İKİNCİ SAHA TESTİ (2026-08-04) — yukarıdaki 8 kontrol YEŞİLKEN tuzak sahada
// ATEŞLEMEDİ. Tablette wifi kapatıldı, aynı top peş peşe girildi; bağlantı
// gelince 46 ms içinde 5 kayıt yazıldı ve hiçbiri 409 almadı. Sebep, mevcut
// kontrollerin GÖREMEDİĞİ iki şeydi ve ikisi de artık kilitli:
//
//   9.  ⭐⭐ YARIŞ (TOCTOU) — ikiz sorgusu tx DIŞINDA ve kilitsizdi; mobil kuyruk
//       bekleyenleri PARALEL boşalttığı için 5 sorgu da hiçbirinin commit'ini
//       görmedi. Artık `pg_advisory_xact_lock` + tx-içi sorgu. **Bu dosyadaki
//       ilk 8 kontrol tamamen SIRALIYDI; yarışı ölçemezlerdi.**
//   10. ⭐ MEŞRU OFFLINE RİTİM — pencere SUNUCU saatiyle ölçülüyordu; offline
//       kuyruk tek flush'ta boşaldığı için her flush DAİMA penceredeydi. Guard
//       atomikleşince bu kez meşru "aynı partiden eşit metrajlı toplar" 409
//       fırtınası üretecekti. Artık `Roll.clientEnteredAt` (istemci beyanı).
//   11. Panik basışı (2 sn arayla) hâlâ takılıyor — damga gevşetme DEĞİL,
//       keskinleştirmedir.
//   12. Damgasız (eski APK) → bugünkü davranış birebir korunur (kademeli dağıtım)
//   13. Geçiş dönemi: ikizin damgası NULL, gelen damgalı → `createdAt` dalı
//   14. Kelepçe: saçma damga (bozuk tablet saati) yok sayılır VE kolona yazılmaz
//   15. Kilit anahtarı DB hassasiyetine yuvarlanıyor (eksik serileşme = delik)
//
// NEGATİF SONDA — hepsi koşuldu, dosyalar md5 ile birebir geri yüklendi:
//   S1  advisory lock satırı silindi          → 9 KIRMIZI (5 girişten 3'ü geçti)
//   S4  damga OR dalı silindi (yalnız createdAt) → 10 KIRMIZI (meşru top 409 aldı)
//   S5  `resolveEntryStamp` kelepçesi kaldırıldı → 14 KIRMIZI (+3 gün damga saklandı)
//   S6  `toFixed(3)` kaldırıldı                → 15 KIRMIZI
// ⚠️ S6'nın İLK hâli YEŞİL kalmıştı: test "700 ≡ 700.0" diyordu, oysa JS'te ikisi
//    AYNI sayıdır — iddia BOŞTU. Ondalık gürültüsüyle (700.0001/700.0004) yeniden
//    yazıldı. Bir bekçiyi değiştirirken sondayı TEKRARLA; "kırmızı verebiliyor mu"
//    kanıtlanmamış kontrol, kontrol değil süstür.
//
// Çalıştır: npx tsx scripts/test_kk1_duplicate_guard.ts
// =============================================================================

import { randomUUID } from "crypto";
import { RollStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { duplicateGuardLockKey } from "../src/services/helpers/duplicate-guard.helper";
import {
  systemSettingService,
  readKk1DuplicateGuardEnabled,
} from "../src/services/system-setting.service";

const inventory = new InventoryService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

/** Tuzağın fırlattığı hatayı yakalar; `null` = hata YOK (giriş geçti). */
async function tryEntry(
  fn: () => Promise<{ data: { id: string } }>,
  sink: string[],
): Promise<{ status?: number; code?: string; message: string } | null> {
  try {
    const res = await fn();
    sink.push(res.data.id);
    return null;
  } catch (e) {
    const err = e as {
      statusCode?: number;
      message?: string;
      details?: { code?: string };
    };
    return {
      status: err.statusCode,
      code: err.details?.code,
      message: err.message ?? "",
    };
  }
}

const GUARD = { duplicateGuard: { confirmed: false } };

async function main() {
  const admin = need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin kullanıcı",
  );
  // İkinci operatör — "aynı elden mi çıktı" ayrımını sınamak için (6).
  const other = await prisma.user.findFirst({
    where: { id: { not: admin.id }, isActive: true },
    select: { id: true },
  });
  const item = need(
    await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif ürün",
  );

  const rollIds: string[] = [];
  const original = await readKk1DuplicateGuardEnabled();

  try {
    // ---- 1) Bayrak KAPALI → tuzak yok (deploy güvenli) ----
    await systemSettingService.setFeatureFlags({ kk1DuplicateGuardEnabled: false }, admin.id);
    check("bayrak kapalı okundu", (await readKk1DuplicateGuardEnabled()) === false);

    const off1 = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 700 }, admin.id, null, false, GUARD),
      rollIds,
    );
    const off2 = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 700 }, admin.id, null, false, GUARD),
      rollIds,
    );
    check(
      "bayrak KAPALI: birebir aynı iki giriş de geçti (davranış değişmedi)",
      off1 === null && off2 === null,
      `${off1?.message ?? "ok"} / ${off2?.message ?? "ok"}`,
    );

    // ---- 2) Bayrak AÇIK → ikinci birebir giriş 409 ----
    await systemSettingService.setFeatureFlags({ kk1DuplicateGuardEnabled: true }, admin.id);
    check("bayrak açık okundu", (await readKk1DuplicateGuardEnabled()) === true);

    const base = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 701, width: 150 }, admin.id, null, false, GUARD),
      rollIds,
    );
    check("açık: ilk giriş geçti", base === null, base?.message);

    const dup = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 701, width: 150 }, admin.id, null, false, GUARD),
      rollIds,
    );
    check(
      "açık: birebir aynı ikinci giriş 409 POSSIBLE_DUPLICATE aldı",
      dup?.status === 409 && dup.code === "POSSIBLE_DUPLICATE",
      dup ? `${dup.status} ${dup.code} ${dup.message}` : "hata fırlatılmadı (KOPYA DOĞDU)",
    );

    // ---- 3) Açık onay → geçer ----
    const confirmed = await tryEntry(
      () =>
        inventory.createInitialEntry({ itemId: item.id, initialQty: 701, width: 150 }, admin.id, null, false, {
          duplicateGuard: { confirmed: true },
        }),
      rollIds,
    );
    check(
      "açık: confirmDuplicate ile geçti (engelleme değil onaylatma)",
      confirmed === null,
      confirmed?.message,
    );

    // ---- 4) Farklı metraj → engel yok ----
    const diffQty = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 702, width: 150 }, admin.id, null, false, GUARD),
      rollIds,
    );
    check("açık: farklı metraj engellenmedi (yanlış-pozitif yok)", diffQty === null, diffQty?.message);

    // ---- 5) ⭐ DAHİLİ ÇAĞRI REGRESYONU — opts YOK → tuzak atlanır ----
    // Tambur "Manuel Ekle" ve manual-produce bu yoldan geçer. Koşulsuz bir tuzak
    // eşit parçaya bölme gibi meşru akışları kırardı.
    const int1 = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 703 }, admin.id),
      rollIds,
    );
    const int2 = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 703 }, admin.id),
      rollIds,
    );
    check(
      "⭐ açık: opts'SUZ dahili çağrı tuzağa GİRMEDİ (tambur-manual korundu)",
      int1 === null && int2 === null,
      `${int1?.message ?? "ok"} / ${int2?.message ?? "ok"}`,
    );

    // ---- 6) Farklı operatör → engel yok ----
    if (other) {
      const otherUser = await tryEntry(
        () => inventory.createInitialEntry({ itemId: item.id, initialQty: 701, width: 150 }, other.id, null, false, GUARD),
        rollIds,
      );
      check(
        "açık: BAŞKA operatörün aynı girişi engellenmedi",
        otherUser === null,
        otherUser?.message,
      );
    } else {
      console.log("⏭️  ikinci aktif kullanıcı yok — operatör ayrımı sınanmadı");
    }

    // ---- 7) Aynı clientToken → idempotent yol (tuzak değil) ----
    const token = "11111111-2222-4333-8444-555555555555";
    const first = await inventory.createInitialEntry(
      { itemId: item.id, initialQty: 704, clientToken: token },
      admin.id,
      null,
      false,
      GUARD,
    );
    rollIds.push(first.data.id);
    const replay = await tryEntry(
      () =>
        inventory.createInitialEntry(
          { itemId: item.id, initialQty: 704, clientToken: token },
          admin.id,
          null,
          false,
          GUARD,
        ),
      [],
    );
    check(
      "açık: AYNI clientToken 409 değil, idempotent cached top döndürdü",
      replay === null,
      replay ? `${replay.status} ${replay.code}` : "",
    );

    // ---- 8) İptal edilmiş ikiz → engel yok ----
    const toCancel = await inventory.createInitialEntry(
      { itemId: item.id, initialQty: 705 },
      admin.id,
      null,
      false,
      GUARD,
    );
    rollIds.push(toCancel.data.id);
    await prisma.roll.update({
      where: { id: toCancel.data.id },
      data: { status: RollStatus.CANCELLED },
    });
    const afterCancel = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 705 }, admin.id, null, false, GUARD),
      rollIds,
    );
    check(
      "açık: İPTAL edilmiş ikiz engellemedi (yeniden giriş = düzeltme)",
      afterCancel === null,
      afterCancel?.message,
    );

    // ---- 9) ⭐⭐ YARIŞ (TOCTOU) — paketin asıl sebebi ----
    // 2026-08-04 saha testi: tablette wifi kapatıldı, aynı top peş peşe girildi,
    // bağlantı gelince kuyruk PARALEL boşaldı ve 46 ms içinde 5 kayıt yazıldı —
    // bayrak AÇIK olmasına rağmen. Sebep: ikiz sorgusu tx DIŞINDA ve kilitsizdi,
    // 5 sorgu da hiçbirinin commit'ini görmedi. Bu vaka onu birebir modeller.
    //
    // ⚠️ `Promise.allSettled` BURADA MEŞRU. CLAUDE.md kuralı 11 (`tx.*` ile
    // Promise.all YASAK) tek bir tx client'ının paylaşılmasına ilişkindir; burada
    // beş AYRI servis çağrısı, beş ayrı havuz bağlantısı, beş ayrı tx var.
    // Emsal: `scripts/test_admin_guard_race.ts`. Bunu "düzeltip" sıralı hale
    // getirirsen bekçi sessizce ölür — mevcut 8 kontrol TOCTOU'yu GÖREMİYORDU.
    const raceStamp = new Date();
    const raceResults = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        inventory.createInitialEntry(
          {
            itemId: item.id,
            initialQty: 706,
            width: 150,
            // FARKLI token (kuyruktaki her basış kendi token'ını taşır),
            // AYNI damga (aynı fiziksel top, aynı basış anı).
            clientToken: randomUUID(),
            clientEnteredAt: raceStamp,
          },
          admin.id,
          null,
          false,
          GUARD,
        ),
      ),
    );
    for (const r of raceResults) {
      if (r.status === "fulfilled") rollIds.push(r.value.data.id);
    }
    const raceOk = raceResults.filter((r) => r.status === "fulfilled").length;
    const raceConflicts = raceResults.filter(
      (r) =>
        r.status === "rejected" &&
        (r.reason as { statusCode?: number }).statusCode === 409 &&
        (r.reason as { details?: { code?: string } }).details?.code === "POSSIBLE_DUPLICATE",
    ).length;
    check(
      "⭐⭐ YARIŞ: 5 eşzamanlı birebir girişten TAM BİRİ geçti",
      raceOk === 1,
      `geçen=${raceOk} (TOCTOU açıksa 5 olur)`,
    );
    check(
      "⭐⭐ YARIŞ: diğer 4'ü 409 POSSIBLE_DUPLICATE aldı (hata tx'ten sağ çıkıyor)",
      raceConflicts === 4,
      `409=${raceConflicts}`,
    );

    // ---- 10) ⭐ MEŞRU OFFLINE RİTİM GEÇER — damganın varlık sebebi ----
    // Çevrimdışı 3'er dakika arayla girilmiş iki eşit metrajlı top (aynı partiden
    // — tekstilde olağan) kuyruk boşalınca sunucuda milisaniyelerle ayrılır.
    // Damga olmasaydı ikincisi 409 alırdı: guard atomikleştirilince yanlış-pozitif
    // fırtınası tam buradan doğardı.
    const t0 = Date.now();
    const rhythm1 = await tryEntry(
      () =>
        inventory.createInitialEntry(
          { itemId: item.id, initialQty: 707, width: 150, clientEnteredAt: new Date(t0 - 6 * 60_000) },
          admin.id, null, false, GUARD,
        ),
      rollIds,
    );
    const rhythm2 = await tryEntry(
      () =>
        inventory.createInitialEntry(
          { itemId: item.id, initialQty: 707, width: 150, clientEnteredAt: new Date(t0 - 3 * 60_000) },
          admin.id, null, false, GUARD,
        ),
      rollIds,
    );
    check(
      "⭐ DAMGA: 3 dk arayla girilmiş iki meşru top da geçti (offline yanlış-pozitifi yok)",
      rhythm1 === null && rhythm2 === null,
      `${rhythm1?.message ?? "ok"} / ${rhythm2?.message ?? "ok"}`,
    );

    // ---- 11) PANİK BASIŞI TAKILIR — damga gevşetme değil, keskinleştirmedir ----
    const panic = await tryEntry(
      () =>
        inventory.createInitialEntry(
          { itemId: item.id, initialQty: 707, width: 150, clientEnteredAt: new Date(t0 - 3 * 60_000 + 2_000) },
          admin.id, null, false, GUARD,
        ),
      rollIds,
    );
    check(
      "⭐ DAMGA: 2 sn arayla aynı giriş 409 aldı (panik basışı yakalanıyor)",
      panic?.status === 409 && panic.code === "POSSIBLE_DUPLICATE",
      panic ? `${panic.status} ${panic.code}` : "hata YOK — damga penceresi çalışmıyor",
    );

    // ---- 12) DAMGASIZ (eski APK) davranış korunuyor ----
    // Sahadaki eski sürüm alanı hiç göndermez → sunucu saatine düşülür, yani
    // bugünkü davranış birebir. Bu regresyon, kademeli APK dağıtımının garantisi.
    const legacy1 = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 708, width: 150 }, admin.id, null, false, GUARD),
      rollIds,
    );
    const legacy2 = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 708, width: 150 }, admin.id, null, false, GUARD),
      rollIds,
    );
    check(
      "damgasız (eski APK): ilk geçti, ikincisi 409 — bugünkü davranış korundu",
      legacy1 === null && legacy2?.status === 409,
      `${legacy1?.message ?? "ok"} / ${legacy2?.status ?? "hata yok"}`,
    );

    // ---- 13) İKİZİN damgası NULL, gelen damgalı → createdAt dalı yakalar ----
    const mixedBase = await tryEntry(
      () => inventory.createInitialEntry({ itemId: item.id, initialQty: 709, width: 150 }, admin.id, null, false, GUARD),
      rollIds,
    );
    const mixedNew = await tryEntry(
      () =>
        inventory.createInitialEntry(
          { itemId: item.id, initialQty: 709, width: 150, clientEnteredAt: new Date() },
          admin.id, null, false, GUARD,
        ),
      rollIds,
    );
    check(
      "geçiş dönemi: damgasız ikiz + damgalı giriş → createdAt dalı yakaladı",
      mixedBase === null && mixedNew?.status === 409,
      `${mixedBase?.message ?? "ok"} / ${mixedNew?.status ?? "hata yok"}`,
    );

    // ---- 14) SAÇMA DAMGA yok sayılır VE kolona yazılmaz ----
    // Yalnız 409'a bakmak yetmez: kelepçe hiç çalışmasa da 409 gelebilirdi.
    // İkinci iddia (kolon NULL) kelepçenin gerçekten uygulandığını kanıtlar.
    const insaneFuture = await inventory.createInitialEntry(
      {
        itemId: item.id,
        initialQty: 710,
        width: 150,
        clientEnteredAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), // +3 gün
      },
      admin.id, null, false, GUARD,
    );
    rollIds.push(insaneFuture.data.id);
    const storedFuture = await prisma.roll.findUnique({
      where: { id: insaneFuture.data.id },
      select: { clientEnteredAt: true },
    });
    check(
      "⭐ KELEPÇE: +3 gün damga SAKLANMADI (kolon NULL)",
      storedFuture?.clientEnteredAt === null,
      `kolon=${String(storedFuture?.clientEnteredAt)}`,
    );
    const afterInsane = await tryEntry(
      () =>
        inventory.createInitialEntry(
          { itemId: item.id, initialQty: 710, width: 150, clientEnteredAt: new Date(Date.now() + 3 * 24 * 60 * 60_000) },
          admin.id, null, false, GUARD,
        ),
      rollIds,
    );
    check(
      "KELEPÇE: saçma damgalı ikinci giriş sunucu saatine düşüp 409 aldı",
      afterInsane?.status === 409,
      afterInsane ? `${afterInsane.status} ${afterInsane.code}` : "hata YOK",
    );

    const sanePast = await inventory.createInitialEntry(
      {
        itemId: item.id,
        initialQty: 711,
        width: 150,
        clientEnteredAt: new Date(Date.now() - 20 * 60 * 60_000), // −20 sa (kuyrukta beklemiş)
      },
      admin.id, null, false, GUARD,
    );
    rollIds.push(sanePast.data.id);
    const storedPast = await prisma.roll.findUnique({
      where: { id: sanePast.data.id },
      select: { clientEnteredAt: true },
    });
    check(
      "KELEPÇE: 20 saat önceki damga MAKUL sayıldı ve saklandı",
      storedPast?.clientEnteredAt != null,
      `kolon=${String(storedPast?.clientEnteredAt)}`,
    );

    // ---- 15) KİLİT ANAHTARI DB HASSASİYETİNE YUVARLANIYOR (DB'siz birim) ----
    // ⚠️ "700 ≡ 700.0" DİYE TEST YAZMA — JS'te ikisi zaten AYNI sayıdır, yani o
    // iddia BOŞTUR ve `toFixed` silinse bile yeşil kalır (2026-08-05'te bu hataya
    // düşüldü, negatif sonda yakaladı). Asıl risk ondalık gürültüsüdür: aşağıdaki
    // iki değer DB'de aynı satıra (700.000) iner ama ham string'lenirse iki
    // FARKLI kilit alır → iki eşzamanlı ikiz birbirini beklemez.
    const kBase = { entrySource: "SUPPLIER_RECEIPT", itemId: item.id, colorId: null, userId: admin.id, machineId: null };
    check(
      "⭐ KİLİT: DB'de aynı satıra inen değerler (700.0001 / 700.0004) AYNI kilidi alıyor",
      duplicateGuardLockKey({ ...kBase, initialQty: 700.0001, width: 150.0002 }) ===
        duplicateGuardLockKey({ ...kBase, initialQty: 700.0004, width: 150.0001 }),
    );
    check(
      "KİLİT: farklı metraj FARKLI anahtar (aşırı serileşme yok)",
      duplicateGuardLockKey({ ...kBase, initialQty: 700, width: 150 }) !==
        duplicateGuardLockKey({ ...kBase, initialQty: 701, width: 150 }),
    );
    check(
      "KİLİT: farklı operatör FARKLI anahtar",
      duplicateGuardLockKey({ ...kBase, initialQty: 700, width: 150 }) !==
        duplicateGuardLockKey({ ...kBase, initialQty: 700, width: 150, userId: "baska-operator" }),
    );
    check(
      "KİLİT: null en ile 0 en KARIŞMIYOR",
      duplicateGuardLockKey({ ...kBase, initialQty: 700, width: null }) !==
        duplicateGuardLockKey({ ...kBase, initialQty: 700, width: 0 }),
    );
  } finally {
    await systemSettingService
      .setFeatureFlags({ kk1DuplicateGuardEnabled: original }, admin.id)
      .catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
