export type EndpointCatalogItem = {
  method: string;
  path: string;
  description: string;
};

export type EndpointCatalogGroup = {
  title: string;
  items: EndpointCatalogItem[];
};

export const endpointCatalog: EndpointCatalogGroup[] = [
  {
    title: "Common",
    items: [
      { method: "GET", path: "/health", description: "Health check" },
      { method: "GET", path: "/", description: "Server metadata and endpoint summary" },
    ],
  },
  {
    title: "OpenAI compatible",
    items: [
      { method: "GET", path: "/v1/models", description: "Model list by default" },
      { method: "POST", path: "/v1/responses", description: "Responses API create/stream/tool calls" },
      { method: "GET", path: "/v1/responses/{response_id}", description: "Retrieve a stored response" },
      { method: "POST", path: "/v1/responses/{response_id}/cancel", description: "Cancel queued responses" },
      { method: "GET", path: "/v1/responses/{response_id}/input_items", description: "List response input items" },
      { method: "POST", path: "/v1/responses/input_tokens", description: "Count response input tokens" },
      { method: "POST", path: "/v1/responses/compact", description: "Create a compacted mock response" },
      { method: "POST", path: "/v1/chat/completions", description: "Chat Completions create/stream/tool calls" },
      { method: "GET", path: "/v1/chat/completions/{completion_id}", description: "Retrieve stored chat completion" },
      { method: "POST", path: "/v1/embeddings", description: "Deterministic embeddings" },
      { method: "POST", path: "/v1/images/generations", description: "Image generation" },
      { method: "POST", path: "/v1/images/edits", description: "Image edits" },
      { method: "POST", path: "/v1/images/variations", description: "Image variations" },
      { method: "POST", path: "/v1/files", description: "Upload mock files" },
      { method: "GET", path: "/v1/files", description: "List mock files" },
    ],
  },
  {
    title: "Anthropic compatible",
    items: [
      { method: "GET", path: "/v1/models", description: "Anthropic list with anthropic-version or x-provider" },
      { method: "GET", path: "/anthropic/v1/models", description: "Legacy Anthropic model list alias" },
      { method: "POST", path: "/v1/messages", description: "Messages create/stream/tool use/thinking" },
      { method: "POST", path: "/v1/messages/count_tokens", description: "Message token counting" },
      { method: "POST", path: "/v1/files", description: "Anthropic-shaped files with provider header" },
      { method: "POST", path: "/anthropic/v1/messages", description: "Legacy Anthropic messages alias" },
    ],
  },
  {
    title: "Gemini compatible",
    items: [
      { method: "GET", path: "/v1/models?provider=gemini", description: "Gemini model list through provider dispatch" },
      { method: "GET", path: "/v1beta/models", description: "Gemini model list" },
      { method: "POST", path: "/v1beta/models/{model}:generateContent", description: "GenerateContent" },
      { method: "POST", path: "/v1beta/models/{model}:streamGenerateContent", description: "SSE GenerateContent stream" },
      { method: "POST", path: "/v1beta/models/{model}:countTokens", description: "Token counting" },
      { method: "POST", path: "/upload/v1beta/files", description: "File upload, including SDK resumable upload" },
      { method: "GET", path: "/v1beta/files", description: "List Gemini files" },
      { method: "POST", path: "/v1beta/cachedContents", description: "Create cached content" },
      { method: "GET", path: "/v1beta/cachedContents", description: "List cached contents" },
    ],
  },
  {
    title: "Legacy aliases",
    items: [
      { method: "GET", path: "/models", description: "OpenAI model list alias" },
      { method: "POST", path: "/chat/completions", description: "OpenAI chat alias" },
      { method: "POST", path: "/images/generations", description: "OpenAI image alias" },
      { method: "GET", path: "/gemini/v1/models", description: "Gemini model list alias" },
      { method: "POST", path: "/gemini/v1/models/{model}/generateContent", description: "Gemini generate alias" },
      { method: "POST", path: "/gemini/v1/models/{model}/streamGenerateContent", description: "Gemini stream alias" },
    ],
  },
];

export function endpointSummary(): string[] {
  return endpointCatalog.flatMap((group) =>
    group.items.map((item) => `${item.method} ${item.path}`)
  );
}

export function formatEndpointCatalog(): string[] {
  return endpointCatalog.flatMap((group) => [
    `   ${group.title}:`,
    ...group.items.map((item) => `   • ${item.method.padEnd(4)} ${item.path} - ${item.description}`),
  ]);
}
