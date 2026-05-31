import { createCrudService } from "@/services/crudService";
import type { ProductRecipe } from "./types";

export const productRecipeService = createCrudService<ProductRecipe>(
  "/api/product-recipes",
);
