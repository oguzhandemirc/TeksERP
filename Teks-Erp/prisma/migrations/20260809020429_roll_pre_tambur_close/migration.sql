-- NOT: `prisma migrate dev` bu dosyayı üretirken iki DropForeignKey satırı da
-- ekledi (rolls_sackId_shipmentId_consistency_fkey + swatches_...). İkisi de ELLE
-- SİLİNDİ — o composite FK'lar Prisma datamodel'inde temsil edilemediği için her
-- diff'te "fazlalık" sanılıp DROP edilmek isteniyor. Kural: schema.prisma:2557-2558.

-- Nullable kolon ekleme PG11+'ta metadata-only'dir: tablo YENİDEN YAZILMAZ,
-- ACCESS EXCLUSIVE kilidi milisaniyeler sürer. ("Canlı tabloya kolon eklemek
-- pahalı" sezgisi DEFAULT'lu kolonlar içindir; ikisi karıştırılıp kolon yerine
-- JSON seçilmemeli — kök CLAUDE.md 2026-08-04 notu.)
-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "preTamburCloseQty" DECIMAL(12,3),
ADD COLUMN     "preTamburCloseStatus" "RollStatus";
