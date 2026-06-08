import { RequestHandler, Router } from "express";
import { handleGetGeminiModels } from "../../controllers/geminiController";

export const geminiModelsRouter: Router = Router();
export const handleListGeminiModels = handleGetGeminiModels;

geminiModelsRouter.get("/", handleListGeminiModels as RequestHandler);

export default geminiModelsRouter;
