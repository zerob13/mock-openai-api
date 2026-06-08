import { RequestHandler, Router } from "express";
import { handleCountTokens } from "./generateContent.routes";

export const geminiTokensRouter: Router = Router();

geminiTokensRouter.post("/:model\\:countTokens", handleCountTokens as RequestHandler);

export default geminiTokensRouter;
