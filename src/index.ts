#!/usr/bin/env node

import app from './app';
import { loadModelMapping, getMappedModelName } from './config/modelMapping';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Enable verbose logging by default in development or when VERBOSE is set
global.verboseLogging = process.env.NODE_ENV !== 'production' || process.env.VERBOSE === 'true';

// Load model mapping configuration
loadModelMapping();

app.listen(PORT, () => {
  console.log(`🚀 Mock OpenAI API server started successfully!`);
  console.log(`📍 Server address: http://${HOST}:${PORT}`);
  console.log(`🔍 Verbose logging: ${global.verboseLogging ? 'enabled' : 'disabled'}`);
  console.log(`📖 API Documentation:`);
  console.log(`   • GET  /health - Health check`);
  console.log(`   • GET  /v1/models - Get OpenAI model list`);
  console.log(`   • POST /v1/chat/completions - OpenAI chat completions`);
  console.log(`   • POST /v1/images/generations - OpenAI image generation`);
  console.log(`   • GET  /anthropic/v1/models - Get Anthropic model list`);
  console.log(`   • POST /anthropic/v1/messages - Anthropic message API`);
  console.log(`   • GET  /v1beta/models - Get Gemini model list`);
  console.log(`   • POST /v1beta/models/{model}:generateContent - Gemini content generation`);
  console.log(`   • POST /v1beta/models/{model}:streamGenerateContent - Gemini streaming generation`);
  console.log(`\n✨ Available models:`);
  console.log(`   OpenAI Compatible:`);
  console.log(`   - ${getMappedModelName('mock-gpt-thinking')}: Model supporting thought process`);
  console.log(`   - ${getMappedModelName('gpt-4-mock')}: Model supporting function calls with tool calls format`);
  console.log(`   - ${getMappedModelName('mock-gpt-markdown')}: Model outputting standard Markdown`);
  console.log(`   - ${getMappedModelName('gpt-4o-image')}: Model specifically for image generation`);
  console.log(`   Anthropic Compatible:`);
  console.log(`   - ${getMappedModelName('mock-claude-markdown')}: Claude markdown sample model`);
  console.log(`   Gemini Compatible:`);
  console.log(`   - ${getMappedModelName('gemini-1.5-pro')}: Advanced multimodal AI model`);
  console.log(`   - ${getMappedModelName('gemini-1.5-flash')}: Fast and efficient model`);
  console.log(`   - ${getMappedModelName('gemini-pro')}: Versatile model for various tasks`);
  console.log(`   - ${getMappedModelName('gemini-pro-vision')}: Multimodal model for text and images`);
  console.log(`\n🔗 Usage example:`);
  console.log(`   curl -X POST http://localhost:${PORT}/v1/chat/completions \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{`);
  console.log(`       "model": "${getMappedModelName('gpt-4-mock')}",`);
  console.log(`       "messages": [{"role": "user", "content": "Hello"}]`);
  console.log(`     }'`);
  console.log(`\n💡 Use CLI for more options: npm run build && npx mock-openai-api --help`);
}); 