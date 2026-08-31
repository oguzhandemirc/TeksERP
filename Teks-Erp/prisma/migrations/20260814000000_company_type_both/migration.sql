-- Ticaret paketi: firma tipine BOTH (Alici + Satici) — sektör standardı üçlü.
-- Tip bir ETIKET, duvar DEGIL: hiçbir akış tipi zorlamaz; deger yalnız
-- liste/rapor filtresini dürüstlestirir (ayni firmaya hem satip hem ondan
-- alan ticaret firmasi tek kartta = tek cari = otomatik mahsup).
-- Kendi migration'ında: ALTER TYPE ADD VALUE ayni transaction içinde kullanılamaz.
ALTER TYPE "CompanyType" ADD VALUE IF NOT EXISTS 'BOTH';
