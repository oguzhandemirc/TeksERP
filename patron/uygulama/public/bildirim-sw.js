// Patron uygulaması web bildirimi service worker'ı — push geldiğinde bildirimi gösterir, dokununca uygulamanın
// KENDİ ekranını açar (yol yalnız aynı kökenden, "/" ile başlayan ve "//" olmayan). Veri: {baslik, metin, rota, tesisId}.
// Bildirim başka tesise aitse tesis `?tesis=` ile geçer; geçişi uygulama yapar (`src/push/taps.ts` webTapFromUrl).
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch (e) {
    d = {};
  }
  const title = typeof d.baslik === "string" ? d.baslik : "TeksERP Patron";
  const body = typeof d.metin === "string" ? d.metin : "";
  const rota = typeof d.rota === "string" && /^\/[a-z-]+(\/[A-Za-z0-9-]{1,64})?$/.test(d.rota) ? d.rota : "/pano";
  const tesisId = typeof d.tesisId === "string" && /^[0-9A-Fa-f-]{36}$/.test(d.tesisId) ? d.tesisId : null;
  event.waitUntil(self.registration.showNotification(title, { body, data: { rota, tesisId }, tag: typeof d.bildirimId === "string" ? d.bildirimId : undefined }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const u = new URL(data.rota || "/pano", self.location.origin);
  if (data.tesisId) u.searchParams.set("tesis", data.tesisId);
  const url = u.href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) return c.navigate(url).then((w) => (w || c).focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});
