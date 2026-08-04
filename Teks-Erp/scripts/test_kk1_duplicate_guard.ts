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
// Çalıştır: npx tsx scripts/test_kk1_duplicate_guard.ts
// =============================================================================

import { RollStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
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
