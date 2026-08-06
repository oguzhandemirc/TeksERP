import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

// GEÇİCİ sürüş — çoklu seçim filtrelerinin gerçekten çalıştığını EKRANDA doğrular.
// Bekçi (`Teks-Erp/scripts/test_filter_multi_select.ts`) where-clause semantiğini
// ölçüyor; burada ölçülen şey UI sözleşmesi: popover'dan iki seçenek işaretlemek
// URL'e CSV yazıyor mu, liste 500 almadan yanıt veriyor mu, tetik etiketi "(2)"
// olarak sayıyor mu. Bitince bu dosya + test-results/ SİLİNİR.
//
// Oturum kalıcı (secure.json) → giriş ekranı çıkarsa koşullu atlanır.
// Navigasyon komut paletiyle: hash ile sekme DEĞİŞMEZ (TabHost kendi durumunu tutar).

// Electron boot + açılış animasyonu + giriş ~50 sn sürüyor; config'in 60 sn'lik
// test limiti bunu tek başına yiyor.
test.setTimeout(240_000);

let app: ElectronApplication;

// Dev DB fabrikanın canlı yedeğiyle değiştirildi → `admin`in şifresi FABRİKANIN.
// Testler kimliği kendileri üretir: `Teks-Erp/scripts/fixture-test-user.ts`.
const USER = "TEST-ADMIN";
const PASS = "TestAdmin2026!";

test.afterEach(async () => {
  await app?.close();
});

/** Giriş ekranı çıktıysa gir; oturum canlıysa sessizce geç. Sonra KABUĞU bekle. */
async function loginIfNeeded(win: Page): Promise<void> {
  const user = win.locator("#username");
  if (await user.isVisible().catch(() => false)) {
    await user.fill(USER);
    await win.locator("#password").fill(PASS);
    await win.getByRole("button", { name: "Giriş Yap" }).click();
  }
  // Girişten sonra AÇILIŞ ANİMASYONU var — sabit timeout yetmez, KABUĞU bekle.
  // ⚠️ `location.hash`'e bakma: oturum zaten açıkken HashRouter kök yolda hash'i
  // hiç YAZMAZ (boş kalır) ve koşul sonsuza dek sağlanmaz — yalnız taze girişten
  // sonraki yönlendirmede "#/" oluşur. Kabuğun kendi elemanı tek güvenilir işaret.
  await expect(win.getByRole("button", { name: /Hızlı arama|Ara veya komut/ })).toBeVisible({
    timeout: 90_000,
  });
  await win.waitForTimeout(2500);
}

/**
 * Komut paletiyle ekran aç. Enter'a KÖRLEMESİNE basmak yanlış ekrana götürür
 * (palet fuzzy eşleşiyor ve ilk sonuç alakasız olabilir) — hedef seçeneğin
 * METNİNE tıklanır. Envanter ekranının paletteki adı "Envanter · <sekme>".
 */
async function openScreen(win: Page, query: string, optionRe: RegExp): Promise<void> {
  await win.keyboard.press("Meta+k");
  await win.waitForTimeout(500);
  await win.keyboard.type(query, { delay: 30 });
  await win.waitForTimeout(1000);
  const target = win.locator("[cmdk-item]").filter({ hasText: optionRe }).first();
  await expect(target, `palette'te "${optionRe}" yok`).toBeVisible({ timeout: 10_000 });
  await target.click();
  await win.waitForTimeout(3000);
}

/** Filtre tetiğini adıyla bul, aç, ilk iki seçeneği işaretle, kapat. */
async function pickTwo(win: Page, label: string): Promise<void> {
  const trigger = win.getByRole("button", { name: new RegExp(`^${label}`) }).first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });

  // ⚠️ `getByRole("option")` KULLANMA: sayfa-boyutu native <select>'inin gizli
  // <option>'ları da eşleşiyor ve .first() onu yakalayıp "hidden" diye düşüyor.
  // cmdk öğeleri `[cmdk-item]` taşır — popover'a özgü tek kesin seçici.
  const options = win.locator("[cmdk-item]");

  // Ekran daha yerleşirken (veri fetch'i + FilterBar yeniden render) tek tıklama
  // yutulabiliyor — popover açılmadıysa tekrar dene. Tek tıklamayla bırakmak
  // sürüşü kırılgan yapıyordu (aynı adım bir koşuda geçti, diğerinde düştü).
  for (let attempt = 0; attempt < 3; attempt++) {
    await trigger.click();
    await win.waitForTimeout(1200); // lookup fetch
    if (await options.first().isVisible().catch(() => false)) break;
  }
  await expect(options.first(), `${label}: popover açılmadı`).toBeVisible({ timeout: 15_000 });
  const count = await options.count();
  expect(count, `${label}: en az 2 seçenek olmalı`).toBeGreaterThanOrEqual(2);

  await options.nth(0).click();
  await win.waitForTimeout(300);
  await options.nth(1).click();
  await win.waitForTimeout(300);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(1200);
}

// ⚠️ FİLTREYİ URL'DEN DOĞRULAMA. Her sekme kendi `createMemoryRouter`'ını taşıyor
// (`components/layout/tabs/tab-routers.tsx`) → `useSearchParams` BELLEĞE yazar,
// `window.location.hash` filtreleri HİÇ görmez (ölçüldü: iki seçim sonrası hash
// boş). Doğrulanacak şey kullanıcının gördüğüdür: tetik "(2)" sayıyor mu, liste
// sunucu hatası almadan yanıt veriyor mu, bağımlı filtre aktifleşiyor mu.

test("Toplar: kumaş + istasyon çoklu seçimi CSV yazar ve liste hata almaz", async () => {
  const errors: string[] = [];
  app = await electron.launch({ args: ["."] });
  const win = await app.firstWindow();
  win.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await win.waitForLoadState("domcontentloaded");
  await loginIfNeeded(win);

  await openScreen(win, "Envanter", /Envanter · /);

  // ── Kumaş (multi-lookup): iki seçenek işaretlenebiliyor ve tetik SAYIYOR ──
  await pickTwo(win, "Kumaş");
  await expect(win.getByRole("button", { name: /^Kumaş \(2\)/ })).toBeVisible({ timeout: 10_000 });

  // ── İstasyon (multi-lookup) — "sessizce düşen filtre" vakasının UI karşılığı ─
  await pickTwo(win, "İstasyon");
  await expect(win.getByRole("button", { name: /^İstasyon \(2\)/ })).toBeVisible({ timeout: 10_000 });

  await win.waitForTimeout(3000);
  await win.screenshot({ path: "test-results/envanter-coklu-filtre.png" });

  // Liste 500 almamalı: apiClient 5xx'te "sunucu hatası" toast'ı basar.
  await expect(win.getByText(/sunucu hatası/i)).toHaveCount(0);
  const serverErrors = errors.filter((e) => /500|uuid|Internal/i.test(e));
  expect(serverErrors, `renderer konsolunda sunucu hatası: ${serverErrors.join(" | ")}`).toHaveLength(0);

  // Tablo hâlâ ayakta (boş sonuç meşru — ölçtüğümüz şey ÇÖKMEME).
  await expect(win.getByRole("table").first()).toBeVisible();
});

test("Siparişler: müşteri çoklu seçimi + bağımlı Şube filtresi açılır", async () => {
  app = await electron.launch({ args: ["."] });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await loginIfNeeded(win);

  await openScreen(win, "Siparişler", /^Siparişler/);

  // Şube başlangıçta PASİF (üst filtre boş).
  await expect(win.getByRole("button", { name: /Şube \(önce müşteri\)/ })).toBeDisabled();

  await pickTwo(win, "Müşteri");
  await expect(win.getByRole("button", { name: /^Müşteri \(2\)/ })).toBeVisible({ timeout: 10_000 });

  // ASIL İDDİA: üst filtre ÇOKLU olunca bağımlı şube filtresi aktifleşir ve
  // seçenekleri gelir (CSV `/api/customer-branches`e aynen gidip `in` oluyor).
  const branch = win.getByRole("button", { name: /^Şube/ }).first();
  await expect(branch).toBeEnabled({ timeout: 10_000 });
  await branch.click();
  await win.waitForTimeout(1500);
  // Sonuç boş OLABİLİR (bu müşterilerin şubesi yoksa) — çökmemesi ölçülüyor.
  await expect(win.getByText(/sunucu hatası/i)).toHaveCount(0);
});
