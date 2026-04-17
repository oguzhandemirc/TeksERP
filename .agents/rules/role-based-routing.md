---
description: "React Router and Component Role Authorization Rules"
globs: "*"
alwaysApply: true
globs: *
alwaysApply: false
---

# Role-Based Routing (RBAC)

Backend tarafında ("core-architecture.md") belirlenen izolasyon prensibi gereği UI da aynı oranda yetki sınırlarına sahip olmalıdır.

## 1. Sayfa Koruması (Protected Routes)
* Sisteme login olmadan kimse giriş yapamaz. Tüm rotalar (public hariç) `<ProtectedRoute>` komponenti ile sarmalanmalıdır.
* Giriş yapan kullanıcının JWT'den okunan rolü Zustand auth state içinde (`user.role`) bulunmalıdır.

## 2. Rota Yönlendirme (Redirection)
* `Admin`: Her sayfaya erişebilir, tüm raporları (Ciro vb.) görebilir.
* `Tambur Operator`: Yalnızca `/tambur` sayfasına yönlendirilir ve oradan dışarı çıkamaz. Navigasyon (SidebarMenu) Admin değilse ona gösterilmez.
* `Shipping / Logistics`: Yalnızca `/shipping` (Sevkiyatlar) sayfasını görebilir. Gelen iş emirlerini ve "Tamamlanmış" parti/stokları görebileceği sınırlı bir izleme/sevk yetkisi vardır.

## 3. Komponent Bazlı Gösterim Yönlendirmesi
Ana sayfalarda her butonu gizlemek için sayfa silinmemeli. Aynı tablo içerisinde silme tuşu sadece yetkililere gösterilmelidir:
```tsx
  {user.role === 'Admin' && <Button onClick={deleteItem}>Sil</Button>}
```
Bu yaklaşım, tüm arayüzlerde yetki karmaşasının önüne geçmek için kural olarak benimsenmiştir.
