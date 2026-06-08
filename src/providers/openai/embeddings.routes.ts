import { Request, RequestHandler, Response, Router } from "express";
import { getInjectedProviderError } from "../../core/errors/errorInjector";
import { buildOpenAIError, ProviderError } from "../../core/errors/providerErrors";
import { estimateTokens } from "../../core/usage/tokenEstimator";
import {
  validateOpenAIEmbeddingsRequest,
  ValidationIssue,
} from "../../core/validation/openaiSchemas";

export const openAIEmbeddingsRouter: Router = Router();

openAIEmbeddingsRouter.post("/", handleCreateEmbedding as RequestHandler);

type EmbeddingsRequest = {
  model?: string;
  input?: string | string[];
  dimensions?: number;
  encoding_format?: "float" | "base64";
};

function handleCreateEmbedding(req: Request, res: Response) {
  const injectedError = getInjectedProviderError({
    provider: "openai",
    headers: req.headers,
    query: req.query as Record<string, unknown>,
  });

  if (injectedError) {
    return sendError(res, injectedError);
  }

  const body = req.body as EmbeddingsRequest;
  const validationResult = validateOpenAIEmbeddingsRequest(body);
  if (!validationResult.ok) {
    return sendError(res, openAIValidationError(validationResult.issue));
  }

  const input = body.input as string | string[];
  const inputs = Array.isArray(input) ? input : [input];
  const dimensions = body.dimensions && body.dimensions > 0 ? Math.min(body.dimensions, 2048) : 8;

  res.json({
    object: "list",
    data: inputs.map((input, index) => ({
      object: "embedding",
      embedding: formatEmbedding(buildEmbedding(input, dimensions), body.encoding_format),
      index,
    })),
    model: body.model,
    usage: {
      prompt_tokens: estimateTokens(inputs),
      total_tokens: estimateTokens(inputs),
    },
  });
}

function buildEmbedding(input: string, dimensions: number): number[] {
  const seed = Array.from(input).reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return Array.from({ length: dimensions }, (_, index) => {
    const value = ((seed + index * 31) % 2000) / 1000 - 1;
    return Number(value.toFixed(6));
  });
}

function formatEmbedding(embedding: number[], encodingFormat: EmbeddingsRequest["encoding_format"]) {
  if (encodingFormat !== "base64") {
    return embedding;
  }

  const buffer = Buffer.alloc(embedding.length * 4);
  embedding.forEach((value, index) => {
    buffer.writeFloatLE(value, index * 4);
  });

  return buffer.toString("base64");
}

function sendError(res: Response, error: ProviderError) {
  res.status(error.status).json(error.body);
}

function openAIValidationError(issue: ValidationIssue): ProviderError {
  if (issue.code === "missing_parameter") {
    return {
      status: 400,
      body: {
        error: {
          message: issue.message,
          type: "invalid_request_error",
          param: issue.param || null,
          code: "missing_parameter",
        },
      },
    };
  }

  return buildOpenAIError(400, issue.message, issue.param || undefined);
}

export default openAIEmbeddingsRouter;
