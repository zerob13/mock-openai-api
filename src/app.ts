import express, { Express } from "express";
import cors from "cors";
import routes from "./routes";

// 扩展全局对象类型
declare global {
  var verboseLogging: boolean;
}

const app: Express = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

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
    availableEndpoints: [
      "GET /health",
      "GET /v1/models",
      "POST /v1/chat/completions",
      "POST /v1/images/generations",
      "GET /anthropic/v1/models",
      "POST /anthropic/v1/messages",
      "GET /v1beta/models",
      "POST /v1beta/models/{model}:generateContent",
      "POST /v1beta/models/{model}:streamGenerateContent",
    ],
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
  console.log(`   - GET /health`);
  console.log(`   - GET /v1/models`);
  console.log(`   - POST /v1/chat/completions`);
  console.log(`   - POST /v1/images/generations`);
  console.log(`   - GET /anthropic/v1/models`);
  console.log(`   - POST /anthropic/v1/messages`);
  console.log(`   - GET /v1beta/models`);
  console.log(`   - POST /v1beta/models/{model}:generateContent`);
  console.log(`   - POST /v1beta/models/{model}:streamGenerateContent`);
  
  res.status(404).json({
    error: {
      message: `Path not found: ${req.originalUrl}`,
      type: "not_found_error",
      code: "path_not_found",
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      availableEndpoints: [
        "GET /health",
        "GET /v1/models",
        "POST /v1/chat/completions",
        "POST /v1/images/generations",
        "GET /anthropic/v1/models",
        "POST /anthropic/v1/messages",
        "GET /v1beta/models",
        "POST /v1beta/models/{model}:generateContent",
        "POST /v1beta/models/{model}:streamGenerateContent",
      ],
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

export default app;
