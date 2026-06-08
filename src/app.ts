import express, { Express } from "express";
import cors from "cors";
import { endpointSummary, formatEndpointCatalog } from "./core/http/endpointCatalog";
import { mockLatencyMiddleware } from "./core/http/mockControls";
import routes from "./routes";

// 扩展全局对象类型
declare global {
  var verboseLogging: boolean;
}

const app: Express = express();
const jsonParser = express.json({ limit: "10mb" });

// Middleware
app.use(cors());
app.use((req, res, next) => {
  if (isGeminiResumableUploadChunk(req)) {
    next();
    return;
  }

  jsonParser(req, res, next);
});
app.use(express.urlencoded({ extended: true }));
app.use(mockLatencyMiddleware());

// Request logging middleware (conditional)
app.use((req, res, next) => {
  if (global.verboseLogging) {
    console.log(`🌐 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    console.log(`🔗 Original URL: ${req.originalUrl}`);
    console.log(`🔗 Base URL: ${req.baseUrl}`);
    console.log(`🔗 Headers:`, JSON.stringify(req.headers, null, 2));
    if (req.body && Object.keys(req.body).length > 0) {
      console.log("📄 Request body:", JSON.stringify(req.body, null, 2));
    }
  }
  next();
});

// Add a simple root endpoint for debugging
app.get("/", (req, res) => {
  res.json({
    message: "Mock OpenAI API Server",
    status: "running",
    timestamp: new Date().toISOString(),
    availableEndpoints: endpointSummary(),
  });
});

// Routes
app.use("/", routes);

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404 - Path not found: ${req.originalUrl}`);
  console.log(`❌ Method: ${req.method}`);
  console.log(`❌ Headers:`, JSON.stringify(req.headers, null, 2));
  console.log(`❌ Available routes:`);
  formatEndpointCatalog().forEach((line) => console.log(line));
  
  res.status(404).json({
    error: {
      message: `Path not found: ${req.originalUrl}`,
      type: "not_found_error",
      code: "path_not_found",
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      availableEndpoints: endpointSummary(),
    },
  });
});

// Global error handler
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Global error:", err);
    res.status(500).json({
      error: {
        message: "Internal server error",
        type: "api_error",
        code: "internal_error",
      },
    });
  }
);

function isGeminiResumableUploadChunk(req: express.Request): boolean {
  const command = req.header("x-goog-upload-command")?.toLowerCase() || "";
  return req.method === "POST" && req.path.startsWith("/upload/v1beta/files/") && !command.includes("start");
}

export default app;
