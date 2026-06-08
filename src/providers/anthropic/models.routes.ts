import { RequestHandler, Router } from "express";
import { handleGetModels } from "../../controllers/anthropicController";

export const anthropicModelsRouter: Router = Router();
export const handleListAnthropicModels = handleGetModels;

anthropicModelsRouter.get("/", handleListAnthropicModels as RequestHandler);

export default anthropicModelsRouter;
