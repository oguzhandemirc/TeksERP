-- Portal genel erişimi (Cloudflare Access): satıcı portalının ERİŞİM dinleyicisinde doğan oturum kendi
-- dinleyicisine bağlıdır (TAILNET oturumuyla karışmaz). Yalnız EKLER; mevcut satırların anlamı değişmez.

-- AlterEnum
ALTER TYPE "PortalDinleyici" ADD VALUE 'ERISIM';
