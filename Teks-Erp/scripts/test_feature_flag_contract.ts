// =============================================================================
// Test: Feature-flag ÜÇ-YER SÖZLEŞMESİ (route şeması ↔ servis ↔ Electron paneli)
// =============================================================================
// VAKA (2026-08-04): `kk1DuplicateGuardEnabled` üç ayağın ikisini aldı —
// `system-setting.service` yazma/okuma dalları ve Electron panel satırı vardı —
// ama `routes/feature-flag.routes.ts` `updateSchema`'sına HİÇ yazılmadı. Şema
// `z.strictObject` olduğu için panelden gelen PATCH 400 döndü: bayrak sahada
// **açılamıyordu ve daha kötüsü KAPATILAMIYORDU** (mükerrer tuzağının tek acil
// geri dönüş yolu odur). Sorun aylarca sessiz kaldı çünkü:
//
//   • `setFeatureFlags(input: Partial<FeatureFlags>)` route'tan gelen DAR nesneyi
//     sorunsuz kabul eder (alt küme ataması geçerlidir) → tip sistemi kör.
//   • Mevcut bayrak testleri (`test_kk1_duplicate_guard`, `test_kk1_weight_flag`)
//     bayrağı `systemSettingService.setFeatureFlags()` ile DOĞRUDAN servisten
//     yazıyor → HTTP rotasını ve `updateSchema`'yı hiç geçmiyorlar.
//
// Yani sözleşme yalnız `feature-flag.routes.ts` başındaki YORUMDA yaşıyordu.
// Bu bekçi onu mekanikleştirir. Dört anahtar kümesi:
//
//   A = API'nin DÖNDÜĞÜ     → getFeatureFlags() çıktısının anahtarları (runtime
//                             gerçeği; `FeatureFlags` bir interface, tip silinir)
//   B = PATCH'in KABUL ETTİĞİ → updateSchema.shape
//   C = servisin YAZDIĞI     → setFeatureFlags dalları (kaynak metni taranır)
//   D = panelin GÖSTERDİĞİ   → Electron settings-config.ts (AYRI PROJE — import
//                              edilemez, kendi tsconfig'i ve `@/` alias'ı var)
//
// ⚠️ KÖRLÜK ZEMİNİ: her kümenin alt sınırı vardır. Bir refactor tarayıcıyı boşa
// düşürürse ("ihlal bulunamadı") ile ("hiçbir şeye bakılmadı") aynı yeşile çıkar.
//
// Çalıştır: npx tsx scripts/test_feature_flag_contract.ts
// =============================================================================

import { readFileSync, existsSync } from "fs";
import path from "path";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { systemSettingService } from "../src/services/system-setting.service";
import prisma from "../src/lib/prisma";

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

// -----------------------------------------------------------------------------
// MUAFLAR — gerekçeli, her koşumda basılır, BAYATLIĞA KARŞI DENETLENİR.
// -----------------------------------------------------------------------------
// Panelde generic toggle olarak GÖRÜNMEYEN boolean bayraklar. Hepsinin kendi
// özel section'ı var (`CategoryKind`: device / session / label), yani "yönetilemez
// bayrak" değiller — yalnız `FlagDef` listesinde durmuyorlar.
const PANEL_EXEMPT: Record<string, string> = {
  devicePairingRequired: "kind:'device' — Mobil Cihazlar section'ı yönetir",
  autoLogoutOnExpiry: "kind:'session' — Oturum section'ı yönetir",
  mobileIdleLockEnabled: "kind:'session' — Oturum section'ı yönetir",
  mobileLockOnBackground: "kind:'session' — Oturum section'ı yönetir",
  pinLockoutEnabled: "kind:'session' — Oturum section'ı yönetir",
  nativeSendEnabled: "kind:'label' — Etiket section'ı yönetir",
  mobileRasterEnabled: "kind:'label' — Etiket section'ı yönetir",
};

const ELECTRON_CONFIG = path.resolve(
  __dirname,
  "../../Electron/src/pages/GeneralSettings/settings-config.ts",
);
const SERVICE_SRC = path.resolve(
  __dirname,
  "../src/services/system-setting.service.ts",
);

function readKeys(file: string, re: RegExp): string[] {
  const src = readFileSync(file, "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(re)) out.add(m[1]!);
  return [...out];
}

async function main() {
  console.log("=== Feature-flag üç-yer sözleşmesi ===\n");

  // ---------------------------------------------------------------------------
  // Kümeleri topla
  // ---------------------------------------------------------------------------
  // ⚠️ `getFeatureFlags` ApiResponse SARMALAR (`{success, data}`) — `.data`'yı
  // almazsan küme {success, data} olur, zemin kontrolleri bunu yakalar.
  const flags = (await systemSettingService.getFeatureFlags()).data as unknown as Record<
    string,
    unknown
  >;
  const A = Object.keys(flags);
  const aBool = A.filter((k) => typeof flags[k] === "boolean");
  const B = Object.keys(updateSchema.shape);
  const C = readKeys(SERVICE_SRC, /hasOwnProperty\.call\(input,\s*"([^"]+)"\)/g);

  const electronFound = existsSync(ELECTRON_CONFIG);
  // Electron ağacı yoksa SESSİZCE ATLAMA — bu bekçinin en çok işe yaradığı
  // kontrol (D) tam da orada yaşıyor; skip, süse dönüşmenin ilk adımıdır.
  check(
    "Electron settings-config.ts bulundu (D kümesi okunabilir)",
    electronFound,
    ELECTRON_CONFIG,
  );
  const D = electronFound
    ? readKeys(ELECTRON_CONFIG, /^\s*key:\s*"([^"]+)"/gm)
    : [];

  console.log(
    `\n   A(api)=${A.length} (boolean ${aBool.length}) · B(şema)=${B.length} · ` +
      `C(servis)=${C.length} · D(panel)=${D.length}\n`,
  );

  // ---------------------------------------------------------------------------
  // 0) KÖRLÜK ZEMİNİ — "hiçbir şey bulamadım" ile "ihlal yok" aynı şey değil
  // ---------------------------------------------------------------------------
  check("zemin: A ≥ 30 anahtar", A.length >= 30, `A=${A.length}`);
  check("zemin: A boolean ≥ 15", aBool.length >= 15, `aBool=${aBool.length}`);
  check("zemin: B ≥ 30 anahtar", B.length >= 30, `B=${B.length}`);
  check("zemin: C ≥ 30 yazma dalı", C.length >= 30, `C=${C.length}`);
  check("zemin: D ≥ 10 panel satırı", D.length >= 10, `D=${D.length}`);

  // ---------------------------------------------------------------------------
  // 1) ⭐ ASIL KONTROL — API'nin döndüğü her boolean bayrak PATCH'lenebilmeli
  // ---------------------------------------------------------------------------
  // `kk1DuplicateGuardEnabled` hatası TAM BURADA yaşıyordu. Boolean daraltması
  // `companyName` / `sessionDurationMinutes` / iç içe nesne gürültüsünü eler —
  // onların kendi doğrulama kuralları var, "toggle" değiller.
  const missingInSchema = aBool.filter((k) => !B.includes(k));
  check(
    "⭐ API'nin döndüğü her boolean bayrak updateSchema'da var",
    missingInSchema.length === 0,
    `şemada YOK: ${missingInSchema.join(", ")} → panelden PATCH 400 alır`,
  );

  // ---------------------------------------------------------------------------
  // 2) Şemanın kabul ettiği her anahtarın bir YAZMA dalı olmalı
  // ---------------------------------------------------------------------------
  // Eksik (2) = uç 200 döner, DB'ye hiçbir şey yazılmaz, hata hiçbir yerde görünmez.
  const acceptedButNotWritten = B.filter((k) => !C.includes(k));
  check(
    "updateSchema'daki her anahtarın setFeatureFlags yazma dalı var",
    acceptedButNotWritten.length === 0,
    `yazılmıyor: ${acceptedButNotWritten.join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 3) Ulaşılamaz yazma dalı olmamalı (ölü kod)
  // ---------------------------------------------------------------------------
  const writtenButNotAccepted = C.filter((k) => !B.includes(k));
  check(
    "setFeatureFlags'te ulaşılamaz yazma dalı yok",
    writtenButNotAccepted.length === 0,
    `şemada YOK ama serviste var: ${writtenButNotAccepted.join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 4) Panelde ÖLÜ toggle olmamalı
  // ---------------------------------------------------------------------------
  const panelGhosts = D.filter((k) => !A.includes(k));
  check(
    "panelin gösterdiği her anahtar API yanıtında var",
    panelGhosts.length === 0,
    `API'de YOK: ${panelGhosts.join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 5) Yönetilemez bayrak olmamalı (panelde ne toggle'ı ne özel section'ı olan)
  // ---------------------------------------------------------------------------
  const unmanaged = aBool.filter((k) => !D.includes(k) && !PANEL_EXEMPT[k]);
  check(
    "yönetilemez boolean bayrak yok (panelde yok + muaf değil)",
    unmanaged.length === 0,
    `${unmanaged.join(", ")} — panele ekle ya da gerekçeli muaf yaz`,
  );

  // ---------------------------------------------------------------------------
  // 6) MUAF BAYATLIĞI — ölü muaf, gerçek bir ihlali sessizce kapsam dışında tutar
  // ---------------------------------------------------------------------------
  const staleUnknown = Object.keys(PANEL_EXEMPT).filter((k) => !aBool.includes(k));
  check(
    "muaf listesinde artık var olmayan bayrak yok",
    staleUnknown.length === 0,
    `API'de yok: ${staleUnknown.join(", ")}`,
  );
  const staleNowInPanel = Object.keys(PANEL_EXEMPT).filter((k) => D.includes(k));
  check(
    "muaf listesindeki bayrak panele eklenmemiş (eklenmişse muafı kaldır)",
    !electronFound || staleNowInPanel.length === 0,
    `artık panelde: ${staleNowInPanel.join(", ")}`,
  );

  // ---------------------------------------------------------------------------
  // 7) DOĞRUDAN SONDA — hatanın kendisini adıyla kilitle
  // ---------------------------------------------------------------------------
  const probe = updateSchema.safeParse({ kk1DuplicateGuardEnabled: true });
  check(
    "⭐ updateSchema `kk1DuplicateGuardEnabled` kabul ediyor (2026-08-04 vakası)",
    probe.success,
    probe.success ? "" : JSON.stringify(probe.error.issues[0]),
  );
  // Ve strictObject hâlâ gerçekten strict — bilinmeyen anahtar 400 vermeli.
  const bogus = updateSchema.safeParse({ __hicBoyleBirBayrakYok: true });
  check(
    "updateSchema strict kalmış (bilinmeyen anahtar reddediliyor)",
    !bogus.success,
    "z.object'e düşürülmüş → yeni bayraklar SESSİZCE atılır",
  );

  // ---------------------------------------------------------------------------
  console.log("\n   Muaflar (panelde generic toggle olarak görünmeyen boolean bayraklar):");
  for (const [k, why] of Object.entries(PANEL_EXEMPT)) {
    console.log(`     · ${k} — ${why}`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
