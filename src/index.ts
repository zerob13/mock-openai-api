#!/usr/bin/env node

import app from './app';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, () => {
  console.log(`🚀 Mock OpenAI API 服务器启动成功!`);
  console.log(`📍 服务地址: http://${HOST}:${PORT}`);
  console.log(`📖 API 文档:`);
  console.log(`   - 模型列表: GET /v1/models`);
  console.log(`   - 聊天完成: POST /v1/chat/completions`);
  console.log(`   - 图像生成: POST /v1/images/generations`);
  console.log(`   - 健康检查: GET /health`);
  console.log(`\n✨ 可用的模型:`);
  console.log(`   - mock-gpt-thinking: 支持思考过程的模型`);
  console.log(`   - mock-gpt-function: 支持函数调用的模型`);
  console.log(`   - mock-gpt-markdown: 输出标准 Markdown 的模型`);
  console.log(`   - gpt-4o-image: 专门用于图像生成的模型`);
  console.log(`\n🔗 使用示例:`);
  console.log(`   curl -X POST http://localhost:${PORT}/v1/chat/completions \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{`);
  console.log(`       "model": "mock-gpt-thinking",`);
  console.log(`       "messages": [{"role": "user", "content": "你好"}]`);
  console.log(`     }'`);
}); 