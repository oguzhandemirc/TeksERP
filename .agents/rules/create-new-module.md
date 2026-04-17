---
description: "Workflow to create a new module, page or feature"
globs: "*"
alwaysApply: false
globs: *
alwaysApply: false
---

# Create New Module Workflow

TeksERP'de (Örn: Sevkiyat - Shipping veya Sipariş - Orders) yeni bir sayfa (modül) tasarlanırken izlenecek standart akış:

## Adım 1: Type & Interface
Backend'de bulunan Prisma Type'larına karşılık gelen TypeScript `interface` dosyasını `src/types/` içinde yaratın (Örn: `src/types/shipping.ts`).

## Adım 2: API Servisini Tanımlama
`src/services/` klasörüne `shippingService.ts` yaratıp, Axios isteklerini fonksiyon olarak modüle edin. (Örn: `getShippings`, `createShipping`).

## Adım 3: Route ve Sayfa İskeleti
- `src/pages/Shipping/` klasörünü yaratın ve içine `ShippingPage.tsx` koyun.
- App ana router'ı içinde yeni sayfanızın React Router Route tanımını yapın (`<Route path="/shipping" element={<ShippingPage />} />`).

## Adım 4: React Query ile Veri Çekme
- `src/hooks/` altına gerekirse özel fetch (Örn: `useShippings`) hook'ları oluşturun.
- Loading süresince Skeleton gösterimi sağlayın.

## Adım 5: Gelişmiş Komponentler
Eğer sayfa büyük bir Modal gerektiriyorsa veya karmaşık bir Form kullanacaksa, bunları alt componentlere ayırın (Örn: `ShippingForm.tsx`, `ShippingTable.tsx`).
Sayfanın karmaşıklığını minimalize edin.
