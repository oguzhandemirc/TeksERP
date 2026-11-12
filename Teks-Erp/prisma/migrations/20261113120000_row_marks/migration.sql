-- CreateEnum
CREATE TYPE "RowMarkColor" AS ENUM ('YELLOW', 'RED', 'GREEN', 'BLUE', 'PURPLE');

-- CreateTable
CREATE TABLE "row_marks" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "recordId" UUID NOT NULL,
    "color" "RowMarkColor",
    "note" VARCHAR(500),
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "row_marks_pkey" PRIMARY KEY ("id")
);

-- Boş işaret satırı tutulmaz: renk ve not ikisi de boşsa servis satırı siler (DB seddi).
ALTER TABLE "row_marks" ADD CONSTRAINT "row_marks_not_empty_chk" CHECK ("color" IS NOT NULL OR "note" IS NOT NULL);

-- CreateIndex
CREATE INDEX "row_marks_entityType_recordId_idx" ON "row_marks"("entityType", "recordId");

-- CreateIndex
CREATE INDEX "row_marks_userId_entityType_idx" ON "row_marks"("userId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "row_marks_userId_entityType_recordId_key" ON "row_marks"("userId", "entityType", "recordId");

-- AddForeignKey
ALTER TABLE "row_marks" ADD CONSTRAINT "row_marks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
