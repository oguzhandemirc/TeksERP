// =============================================================================
// İzole belge baskısı — Y3 fix
// =============================================================================
// window.print() ekran DOM'unu basıyordu: .print-area'nın @media print'teki
// `position:absolute`'u en yakın positioned ataya (DialogContent → TabPane →
// AppShell, hepsi overflow-hidden/transform'lu) göre çözülür → uzun belge tek
// sayfaya kırpılır, dar/kaymış basılır; arka plan sekmesinde açık başka bir
// irsaliye de aynı baskıya biner. Çözüm: .print-area gizli bir iframe'e klonlanır
// ve İFRAME basılır — layout zinciri yok, sayfalama doğal, tek belge garantili.
// =============================================================================

/**
 * Verilen kökün içindeki (veya kendisi olan) `.print-area`'yı izole iframe'de
 * yazdırır. Alan bulunamazsa güvenli geri düşüş: klasik window.print().
 */
/**
 * Saha #7: tam bir HTML belgesini (backend'den gelen birleşik etiket çıktısı gibi)
 * izole iframe'de yazdırır. printDocumentArea DOM klonlar; bu ise verilen HTML
 * string'ini doğrudan iframe'e yazar (kendi <style>'ını taşır).
 */
export function printHtmlString(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // GÜVENLİK (2026-08-03, refakat kartı Faz 2): basılan HTML artık KULLANICI
  // YAZIMI olabiliyor (Şablon Stüdyosu uzman modu). Sandbox'sız bir iframe'de
  // gömülü <script> Electron renderer'ında ÇALIŞIR — ölçüldü, varsayılmadı.
  //
  // İki izin de LOAD-BEARING, kırpma:
  //   allow-same-origin → parent'ın contentDocument'a erişip doc.write ile
  //                       belgeyi yazması için. Yoksa iframe opak origin olur ve
  //                       aşağıdaki doc.open() sessizce null'a düşer (baskı ölür).
  //   allow-modals      → win.print() yazdırma diyaloğunu açabilsin diye.
  // allow-scripts BİLEREK YOK → gömülü script çalışmaz. (Sunucu tarafında ayrıca
  // sanitizeTemplateHtml script'i ayıklar; bu ikinci savunma hattıdır.)
  iframe.setAttribute("sandbox", "allow-same-origin allow-modals");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => iframe.remove();
  const images = Array.from(doc.images);
  const waitImages = Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }),
    ),
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
  void Promise.race([waitImages, timeout]).then(() => {
    requestAnimationFrame(() => {
      win.focus();
      win.addEventListener("afterprint", cleanup, { once: true });
      win.print();
      setTimeout(cleanup, 60_000);
    });
  });
}

export function printDocumentArea(root: HTMLElement | null): void {
  const area = root?.classList.contains("print-area")
    ? root
    : (root?.querySelector<HTMLElement>(".print-area") ?? null);
  if (!area) {
    window.print();
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // Bu yol uygulamanın KENDİ DOM'unu klonlar (kullanıcı HTML'i taşımaz), ama
  // baskı yüzeyini tek bir güvenlik duruşunda tutmak için aynı sandbox uygulanır
  // — "biri korumalı, öteki değil" hâli ileride yanlış tarafa örnek olur.
  iframe.setAttribute("sandbox", "allow-same-origin allow-modals");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    window.print();
    return;
  }

  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  doc.close();

  // Uygulamanın tüm stilleri (Vite'ın inject ettiği <style> + <link rel=stylesheet>)
  // iframe'e kopyalanır — belge bileşenleri ekrandakiyle aynı CSS'le render olur.
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    doc.head.appendChild(node.cloneNode(true));
  });

  const clone = area.cloneNode(true) as HTMLElement;
  doc.body.appendChild(clone);

  // cloneNode canvas İÇERİĞİNİ kopyalamaz (QR kodlar boş çıkar) — piksel kopyala.
  const srcCanvases = area.querySelectorAll("canvas");
  const dstCanvases = clone.querySelectorAll("canvas");
  srcCanvases.forEach((src, i) => {
    const dst = dstCanvases[i];
    if (!dst) return;
    dst.width = src.width;
    dst.height = src.height;
    dst.getContext("2d")?.drawImage(src, 0, 0);
  });

  const cleanup = () => iframe.remove();

  // Görseller (logo/barkod img'leri) yüklensin, sonra bas. Emniyet tavanı 2sn.
  const images = Array.from(doc.images);
  const waitImages = Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }),
    ),
  );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));

  void Promise.race([waitImages, timeout]).then(() => {
    // Stil hesaplaması otursun diye bir frame bekle.
    requestAnimationFrame(() => {
      win.focus();
      win.addEventListener("afterprint", cleanup, { once: true });
      win.print();
      // afterprint bazı durumlarda gelmez (iptal vb.) — emniyet temizliği.
      setTimeout(cleanup, 60_000);
    });
  });
}
