-- CreateTable
CREATE TABLE "product_recipes" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "itemId" TEXT NOT NULL,
    "colorId" TEXT,
    "width" DECIMAL(12,3),
    "foldType" TEXT,
    "routeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_recipe_properties" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_recipe_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_recipes_code_key" ON "product_recipes"("code");

-- CreateIndex
CREATE INDEX "product_recipes_itemId_idx" ON "product_recipes"("itemId");

-- CreateIndex
CREATE INDEX "product_recipes_colorId_idx" ON "product_recipes"("colorId");

-- CreateIndex
CREATE INDEX "product_recipes_routeId_idx" ON "product_recipes"("routeId");

-- CreateIndex
CREATE INDEX "product_recipe_properties_propertyId_idx" ON "product_recipe_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "product_recipe_properties_recipeId_propertyId_key" ON "product_recipe_properties"("recipeId", "propertyId");

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_properties" ADD CONSTRAINT "product_recipe_properties_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "product_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_properties" ADD CONSTRAINT "product_recipe_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
