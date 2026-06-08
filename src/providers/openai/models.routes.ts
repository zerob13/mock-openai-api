import { RequestHandler, Router } from "express";
import { handleGetModels } from "../../controllers/openaiController";

export const openAIModelsRouter: Router = Router();
export const handleListOpenAIModels = handleGetModels;

openAIModelsRouter.get("/", handleListOpenAIModels as RequestHandler);

export default openAIModelsRouter;
