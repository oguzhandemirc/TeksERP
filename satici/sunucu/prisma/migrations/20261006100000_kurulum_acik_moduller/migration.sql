-- K10: fabrikanın yoklamada bildirdiği açık modül adları (nullable: eski fabrika bildirmez; DURUM kolonu, defter değil).
ALTER TABLE "kurulum" ADD COLUMN "acikModuller" JSONB, ADD COLUMN "acikModullerZamani" TIMESTAMPTZ;
