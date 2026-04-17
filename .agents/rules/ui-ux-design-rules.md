---
description: "UI/UX, Styling and Design System Rules for TeksERP Frontend"
globs: "*.tsx, *.jsx, *.css"
alwaysApply: true
---

# TeksERP UI/UX & Design Rules

## 1. Styling Stack
*   **CSS Framework:** Tailwind CSS v4. Özel (custom) CSS yazmaktan kaçınılmalı, tüm stil işlemleri Tailwind utility class'ları ile çözülmelidir.
*   **Component Library:** Geliştirme hızını artırmak için **Shadcn UI** veya benzeri Tailwind uyumlu, özelleştirilebilir "Headless" kütüphaneler tercih edilmelidir. (Radix UI temelinde).
*   **Icons:** Lucide React veya Heroicons.

## 2. Responsive Design (Mobile-First)
*   Uygulama temel olarak iki ana platforma hitap eder: 
    1. Yöneticiler (Masaüstü / Desktop kullanım - Geniş ekranlar, veri tabloları).
    2. Kurşun / Tambur operatörleri (Tablets & Mobile kullanım - Dokunmatik arayüz, büyük butonlar).
*   Tasarım her zaman **Mobile-First** stratejisiyle (mobil düşünülerek) başlanmalı, Tailwind breakpointleri (`sm:`, `md:`, `lg:`) kullanılarak genişletilmelidir.
*   Tablet ekranı (iPad boyutu) fabrika içi uygulamalar için kritik bir hedeftir.

## 3. Interactivity & Feedback
*   **Premium His:** Kullanıcı butona bastığında veya sayfa değiştiğinde pürüzsüz geri bildirimler sağlanmalıdır. (Kısa `transition-all duration-200` gibi Tailwind class'ları eklenebilir).
*   **Error / Success Messaging:** Başarılı işlem veya hata durumları "Toast" bildirimleriyle (Örn: React Hot Toast veya Sonner) anında gösterilmeli. Toast mesajları backend'den gelen mesajı içermelidir (örn. iş kuralları ihlalleri).
*   **Loading States:** Tablolar ve veri panelleri veri beklerken Skeleton UI göstermeli, butonlar `isLoading` state ile dönen spinner almalı ve iki kere tıklanmayı engellemek için devre dışı (disabled) bırakılmalıdır.

## 4. Accessibility (A11y)
*   Sistem genelindeki input ve elementlerin klavye navigasyonunu (tabbing) desteklemesi, renk kontrastlarının yeterli olması gerekmektedir (Shadcn UI bunu büyük oranda sağlar).
