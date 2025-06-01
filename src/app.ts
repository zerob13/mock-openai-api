import express from 'express';
import cors from 'cors';
import router from './routes';

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 请求日志中间件
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// 路由
app.use('/', router);

// 404 处理
app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `未找到路径: ${req.originalUrl}`,
      type: 'not_found_error'
    }
  });
});

// 全局错误处理
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('全局错误:', err);
  res.status(500).json({
    error: {
      message: '内部服务器错误',
      type: 'internal_server_error'
    }
  });
});

export default app; 
