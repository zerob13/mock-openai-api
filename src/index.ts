#!/usr/bin/env node

import app from './app';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Enable verbose logging by default in development or when VERBOSE is set
global.verboseLogging = process.env.NODE_ENV !== 'production' || process.env.VERBOSE === 'true';

app.listen(PORT, () => {
  console.log(`🚀 Mock OpenAI API server started successfully!`);
  console.log(`📍 Server address: http://${HOST}:${PORT}`);
  console.log(`🔍 Verbose logging: ${global.verboseLogging ? 'enabled' : 'disabled'}`);
  console.log(`📖 API Documentation:`);
  console.log(`   • GET  /health - Health check`);
  console.log(`   • GET  /v1/models - Get model list`);
  console.log(`   • POST /v1/chat/completions - Chat completions`);
  console.log(`   • POST /v1/images/generations - Image generation`);
  console.log(`   • POST /v1beta/models/gemini-pro:generateContent - Gemini completions`);
  console.log(`   • POST /v1beta/models/gemini-2.0-flash:generateContent - Gemini completions`);
  console.log(`\n✨ Available models:`);
  console.log(`   - mock-gpt-thinking: Model supporting thought process`);
  console.log(`   - gpt-4-mock: Model supporting function calls with tool calls format`);
  console.log(`   - mock-gpt-markdown: Model outputting standard Markdown`);
  console.log(`   - gpt-4o-image: Model specifically for image generation`);
  console.log(`\n🔗 Usage example:`);
  console.log(`   curl -X POST http://localhost:${PORT}/v1/chat/completions \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{`);
  console.log(`       "model": "gpt-4-mock",`);
  console.log(`       "messages": [{"role": "user", "content": "Hello"}]`);
  console.log(`     }'`);
  console.log(`\n💡 Use CLI for more options: npm run build && npx mock-openai-api --help`);
}); 