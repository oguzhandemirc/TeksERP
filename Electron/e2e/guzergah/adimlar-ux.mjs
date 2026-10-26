// =============================================================================
// GÜZERGÂH · UX — dar ekran (UX-3 responsive): 390 px telefon · 768 px tablet
// =============================================================================
// UX1..UX3: 20 ana sayfa (üç parça) × 390/768 — sayfada YATAY KAYDIRMA YOK. İki ölçü: belge
//      (`documentElement.scrollWidth <= innerWidth`) ve etkin sekmenin kaydırma
//      kabı (`.tab-pane.z-10 > div`; kabuk `overflow-hidden` olduğu için asıl
//      taşma burada görünür). Tablolar kendi kaydırmalı kabında kalır — ölçüme girmez.
// UX4: ≤1024 px kenar çubuğu satır-içi DEĞİL; hamburger çekmeceyi açar, menü
//      seçimi kapatır (açık çekmece sayfanın/diyaloğun üstünde kalmaz).
// UX5: 390 px'te sekme diyaloğu sekme kabını tam kaplar (tam ekran).
// Pencere boyutu CDP öykünmesiyle verilir; adım sonunda eski boyuta döner.
// =============================================================================
const SAYFALAR = [
  "Anasayfa", "Operasyon", "Tanımlar", "Raporlar", "Yetkilendirme", "Sistem", "Maliyet & Teklif",
  "Siparişler", "Sevkiyatlar", "Terbiye İş Emirleri", "Kumaş Stoğu", "Ürünler", "Cariler", "Faturalar",
  "Kasa & Banka", "Mal Kabul", "Teklifler", "Leventler", "Dokuma İş Emirleri", "Modüller",
];
const GENISLIKLER = [390, 768];
const olc = {};

/** Etkin sekmenin yatay taşması (px) + belgenin taşması; sekme yoksa null. */
async function tasmaOlc(page) {
  return page.evaluate(() => {
    const sc = document.querySelector(".tab-pane.z-10 > div");
    return {
      belge: document.documentElement.scrollWidth - window.innerWidth,
      sekme: sc ? sc.scrollWidth - sc.clientWidth : null,
    };
  });
}

/** Boyutu öykün, iş bitince eski boyuta dön (sonraki adımlar masaüstü ölçüsünde koşar). */
async function boyutla(page, genislik, is) {
  const eski = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  try {
    await page.setViewportSize({ width: genislik, height: genislik < 500 ? 844 : 1024 });
    await page.waitForTimeout(400);
    return await is();
  } finally {
    await page.setViewportSize(eski);
  }
}

/** UX1..UX3: sayfalar üç parçada (adım başına 60 sn sınırı) — her sayfa 390 ve 768 px'te ölçülür. */
function tasmaAdimi(parca) {
  const id = `UX${parca + 1}`;
  const sayfalar = SAYFALAR.slice(parca * 7, parca * 7 + 7);
  return {
    id, rol: "P",
    // İlk adım giriş açılışını taşır: engellenen varsayılan 4000 sondası (ERR_BLOCKED_BY_CLIENT) + "Sunucuya ulaşılamıyor" toast'ı.
    beklenenHatalar: parca === 0 ? [{ konsol: /ERR_BLOCKED_BY_CLIENT/ }, { toast: /Sunucuya ulaşılamıyor/ }] : [],
    yol: `${sayfalar.join(" · ")} → pencere 390 px ve 768 px → sayfa yatay kaymıyor (belge + sekme kabı)`, rota: "(kabuk)",
    async yap({ git, page }) {
      olc[id] = [];
      for (const ad of sayfalar) {
        await git(ad);
        await page().waitForTimeout(1000);
        for (const w of GENISLIKLER) {
          const m = await boyutla(page(), w, () => tasmaOlc(page()));
          olc[id].push({ ad, w, ...m });
        }
      }
    },
    dogrula: [
      { ad: "her sayfa ölçüldü (sekme kabı bulundu)", sql: "SELECT 1", oku: () => olc[id]?.filter((m) => m.sekme == null).map((m) => `${m.ad}@${m.w}`).join(", ") || "yok", beklenen: "yok" },
      { ad: "yatay taşan sayfa yok (≤1 px)", sql: "SELECT 1", oku: () => olc[id]?.filter((m) => m.belge > 0 || (m.sekme ?? 0) > 1).map((m) => `${m.ad}@${m.w}:${m.belge}/${m.sekme}`).join(", ") || "yok", beklenen: "yok" },
    ],
  };
}

export const UX_ADIMLARI = [
  ...[0, 1, 2].map((parca) => tasmaAdimi(parca)),
  {
    id: "UX4", rol: "P",
    yol: "Anasayfa → pencere 390 px → kenar çubuğu yok → hamburger → çekmece açık → Operasyon → çekmece kapandı, Operasyon açık", rota: "(kabuk)",
    async yap({ git, page }) {
      await git("Anasayfa");
      olc.ux4 = await boyutla(page(), 390, async () => {
        const p = page();
        const satirIci = await p.locator("aside").filter({ visible: true }).count();
        await p.getByRole("button", { name: "Kenar çubuğu" }).click({ timeout: 10_000 });
        const cekmece = p.getByTestId("sidebar-drawer");
        await cekmece.waitFor({ timeout: 10_000 });
        const kutu = await cekmece.boundingBox();
        await cekmece.getByRole("button", { name: "Operasyon", exact: true }).first().click({ timeout: 10_000 });
        await cekmece.waitFor({ state: "detached", timeout: 10_000 });
        const baslik = await p.locator(".tab-pane.z-10 h1").first().textContent({ timeout: 10_000 }).catch(() => null);
        return { satirIci, cekmeceGenislik: kutu?.width ?? null, baslik: baslik?.trim() ?? null };
      });
    },
    dogrula: [
      { ad: "390 px'te satır-içi kenar çubuğu yok", sql: "SELECT 1", oku: () => olc.ux4?.satirIci, beklenen: 0 },
      { ad: "çekmece ekrana sığıyor", sql: "SELECT 1", oku: () => olc.ux4?.cekmeceGenislik, beklenen: (w) => w != null && w > 150 && w <= 390 },
      { ad: "menü seçimi çekmeceyi kapattı ve sayfayı açtı", sql: "SELECT 1", oku: () => olc.ux4?.baslik, beklenen: "Operasyon" },
    ],
  },
  {
    id: "UX5", rol: "P",
    yol: "Ürünler → pencere 390 px → Yeni → form diyaloğu sekme kabını tam kaplıyor → Esc", rota: "definitions/items",
    async yap({ git, page }) {
      await git("Ürünler");
      olc.ux5 = await boyutla(page(), 390, async () => {
        const p = page();
        await p.locator(".tab-pane.z-10").getByRole("button", { name: "Yeni", exact: true }).click({ timeout: 10_000 });
        const d = p.locator(".tab-pane.z-10 [data-ui-dialog]").first();
        await d.waitFor({ timeout: 10_000 });
        await p.waitForTimeout(300);
        const [dk, sk] = [await d.boundingBox(), await p.locator(".tab-pane.z-10").boundingBox()];
        await p.keyboard.press("Escape");
        await d.waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
        return { dk, sk };
      });
    },
    dogrula: [
      {
        ad: "diyalog sekme kabını tam kaplıyor (±1 px)", sql: "SELECT 1",
        oku: () => JSON.stringify(olc.ux5),
        beklenen: () => {
          const { dk, sk } = olc.ux5 ?? {};
          if (!dk || !sk) return false;
          return ["x", "y", "width", "height"].every((k) => Math.abs(dk[k] - sk[k]) <= 1);
        },
      },
    ],
  },
];
