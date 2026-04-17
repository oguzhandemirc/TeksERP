import { createCrudService } from "./crudService";
import type { Route } from "@/types/models";

export const routeService = createCrudService<Route>("/api/routes");
