// =============================================================================
// Cloudflare Worker — "fabrika kapalı" sayfası (Error 1033 yerine)
// =============================================================================
// SORUN: fabrika sunucusu ya da fabrikanın interneti kapalıyken tünelin
// Cloudflare tarafında bir bağlantısı kalmaz ve kenar, ziyaretçiye kendi
// sayfasını basar: **"Error 1033 — Argo Tunnel error"**. Patron için bu cümle
// hiçbir şey ifade etmez; "sistem çöktü mü, ben mi yanlış yaptım, arayayım mı"
// sorusunu cevapsız bırakır ve her seferinde bir telefon üretir.
//
// ⚠️ BU BİR TÜNEL AYARIYLA ÇÖZÜLEMEZ. `config.yml` yalnız `cloudflared`
// KOŞARKEN okunur; sorunun tanımı zaten "cloudflared koşmuyor"dur. Sayfayı
// basacak olan şey, fabrikadan BAĞIMSIZ çalışan tek katmandır: Cloudflare'in
// kendi kenarı. Bu yüzden çözüm Worker'dır.
//
// KURULUM: reçetenin "Hata sayfası" bölümü (docs/ops/UZAK-ERISIM-KURULUM.md).
// Route: `<musteri>-erp.etkiliyazilim.com/*`
//
// ⚠️ ACCESS'İ ETKİLEMEZ. Cloudflare Access, isteği Worker'a vermeden ÖNCE
// koşar — yani kimlik duvarı yerinde kalır ve bu dosyanın onunla hiçbir işi
// yoktur. Worker yalnız "origin cevap veremedi" durumunu güzelleştirir.
//
// ⚠️ ÖZYİNELEME YOK: Worker içinden yapılan `fetch(request)` alt-isteği aynı
// Worker'a geri girmez, doğrudan origin'e (tünele) gider.
// =============================================================================

/** Origin'in "ölü" sayıldığı durumlar. 530 = Argo Tunnel (1033 ailesi). */
const ORIGIN_DOWN = new Set([502, 503, 504, 521, 522, 523, 524, 530]);

export default {
  async fetch(request) {
    let res;
    try {
      res = await fetch(request);
    } catch {
      // Alt-istek hiç kurulamadı — origin kesinlikle ulaşılamaz.
      return renderDown(request);
    }
    if (!ORIGIN_DOWN.has(res.status)) return res;
    return renderDown(request);
  },
};

function renderDown(request) {
  // ⚠️ API İSTEĞİNE HTML BASMA. Panel bir SPA: `/api/...` çağrısına HTML dönerse
  // istemci JSON ayrıştırma hatasına düşer ve kullanıcı "beklenmeyen hata"
  // görür — düzeltmeye çalıştığımız belirsizliğin aynısı, bu kez daha kötüsü.
  // Sunucunun kendi sözleşmesiyle aynı şekilde cevap verilir.
  const url = new URL(request.url);
  const wantsJson =
    url.pathname.startsWith("/api/") ||
    (request.headers.get("accept") ?? "").includes("application/json");

  const headers = {
    // Hata sayfası ASLA önbelleğe alınmaz: fabrika 2 dakika sonra açıldığında
    // ziyaretçi hâlâ "kapalı" sayfasını görürdü (uzun-cache dersinin ikizi —
    // `always` başlığı 404'ü bir hafta tutmuştu).
    "cache-control": "no-store, no-cache, must-revalidate",
    "retry-after": "60",
  };

  if (wantsJson) {
    return new Response(
      JSON.stringify({
        success: false,
        message:
          "Fabrika sunucusuna şu anda ulaşılamıyor. Sunucu ya da fabrika interneti kapalı olabilir.",
        details: { code: "ORIGIN_UNREACHABLE" },
      }),
      { status: 503, headers: { ...headers, "content-type": "application/json; charset=utf-8" } },
    );
  }

  return new Response(SAYFA, {
    status: 503,
    headers: { ...headers, "content-type": "text/html; charset=utf-8" },
  });
}

// Tek dosyada, harici varlık YOK: origin ölüyken bir logo/CSS indirmeye çalışmak
// ikinci bir hata üretirdi (sayfanın kendisi de aynı ölü origin'den gelirdi).
const SAYFA = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fabrika sunucusuna ulaşılamıyor</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       background:#f6f7f9;color:#1c2024}
  @media (prefers-color-scheme:dark){body{background:#111315;color:#e7e9ea}
    .kart{background:#191c1f!important;border-color:#2b3034!important}
    .not{background:#101214!important;border-color:#2b3034!important}}
  .kart{max-width:33rem;margin:1.5rem;padding:1.75rem;border-radius:14px;
        background:#fff;border:1px solid #e3e6ea}
  h1{margin:.4rem 0 .6rem;font-size:1.15rem}
  p{margin:.5rem 0;color:inherit;opacity:.85}
  ul{margin:.4rem 0 0;padding-left:1.15rem;opacity:.85}
  li{margin:.25rem 0}
  .not{margin-top:1.1rem;padding:.7rem .85rem;border-radius:10px;
       background:#f2f4f6;border:1px solid #e3e6ea;font-size:.83rem;opacity:.8}
  button{margin-top:1.15rem;padding:.55rem 1rem;border-radius:9px;border:0;
         background:#1c2024;color:#fff;font:inherit;font-weight:600;cursor:pointer}
  @media (prefers-color-scheme:dark){button{background:#e7e9ea;color:#111315}}
</style></head><body><div class="kart">
  <div style="font-size:1.6rem">🏭</div>
  <h1>Fabrika sunucusuna şu anda ulaşılamıyor</h1>
  <p>Uygulamada bir arıza yok ve verileriniz güvende. Bağlantı, fabrikadaki
     sunucuya ulaşamadığı için kesildi.</p>
  <p>Genellikle sebebi şunlardan biridir:</p>
  <ul>
    <li>Fabrikadaki sunucu bilgisayarı kapalı ya da yeniden başlıyor</li>
    <li>Fabrikanın internet bağlantısı kesik</li>
    <li>Elektrik kesintisi</li>
  </ul>
  <p>Sunucu açıldığında bu sayfa kendiliğinden çalışmaya başlar; yapmanız
     gereken bir ayar yok. Sürüyorsa fabrikayı arayıp sunucu bilgisayarının
     açık olup olmadığını sordurun.</p>
  <button onclick="location.reload()">Tekrar dene</button>
  <div class="not">Bu sayfayı Cloudflare kenarı gösteriyor — yani internetiniz
     ve girişiniz çalışıyor, ulaşılamayan yalnız fabrikadaki sunucu.</div>
</div></body></html>`;
