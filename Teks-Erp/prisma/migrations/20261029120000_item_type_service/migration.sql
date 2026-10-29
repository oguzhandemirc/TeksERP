-- H6 (Gülkesim dalga 2): hizmet kalemi türü. Tek ifadeli dosya — PG yeni enum
-- değerini onu ekleyen tx'te kullandırmaz (55P04); kullanan ifade ayrı migration'da.
ALTER TYPE "ItemType" ADD VALUE IF NOT EXISTS 'SERVICE';
