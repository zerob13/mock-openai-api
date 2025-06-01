#!/usr/bin/env node

import app from './app';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, () => {
  console.log(`🚀 Mock OpenAI API server started successfully!`);
  console.log(`📍 Server address: http://${HOST}:${PORT}`);
  console.log(`📖 API Documentation:`);
  console.log(`   • GET  /health - Health check`);
  console.log(`   • GET  /v1/models - Get model list`);
  console.log(`   • POST /v1/chat/completions - Chat completions`);
  console.log(`   • POST /v1/images/generations - Image generation`);
  console.log(`\n✨ Available models:`);
  console.log(`   - mock-gpt-thinking: Model supporting thought process`);
  console.log(`   - mock-gpt-function: Model supporting function calls with tool calls format`);
  console.log(`   - mock-gpt-markdown: Model outputting standard Markdown`);
  console.log(`   - gpt-4o-image: Model specifically for image generation`);
  console.log(`\n🔗 Usage example:`);
  console.log(`   curl -X POST http://localhost:${PORT}/v1/chat/completions \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{`);
  console.log(`       "model": "mock-gpt-function",`);
  console.log(`       "messages": [{"role": "user", "content": "Hello"}]`);
  console.log(`     }'`);
  console.log(`\n💡 Use CLI for more options: npm run build && npx mock-openai-api --help`);
}); 