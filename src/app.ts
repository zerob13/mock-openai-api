import express from 'express';
import cors from 'cors';
import routes from './routes';

// 扩展全局对象类型
declare global {
  var verboseLogging: boolean;
}

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware (conditional)
app.use((req, res, next) => {
  if (global.verboseLogging) {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    if (req.body && Object.keys(req.body).length > 0) {
      console.log('Request body:', JSON.stringify(req.body, null, 2));
    }
  }
  next();
});

// Routes
app.use('/', routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Path not found: ${req.originalUrl}`,
      type: 'not_found_error',
      code: 'path_not_found'
    }
  });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error:', err);
  res.status(500).json({
    error: {
      message: 'Internal server error',
      type: 'api_error',
      code: 'internal_error'
    }
  });
});

export default app; 
