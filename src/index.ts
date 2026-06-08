#!/usr/bin/env node

import app from './app';
import { formatEndpointCatalog } from './core/http/endpointCatalog';
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
  formatEndpointCatalog().forEach((line) => console.log(line));
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
  console.log(`\n🔗 Usage examples:`);
  console.log(`   # OpenAI Responses API`);
  console.log(`   curl -X POST http://localhost:${PORT}/v1/responses \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{`);
  console.log(`       "model": "gpt-4.1-mini",`);
  console.log(`       "input": "Hello from a local agent harness"`);
  console.log(`     }'`);
  console.log(``);
  console.log(`   # Anthropic Messages API`);
  console.log(`   curl -X POST http://localhost:${PORT}/v1/messages \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -H "anthropic-version: 2023-06-01" \\`);
  console.log(`     -d '{"model":"claude-sonnet-4-5","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'`);
  console.log(``);
  console.log(`   # Gemini GenerateContent API`);
  console.log(`   curl -X POST http://localhost:${PORT}/v1beta/models/gemini-1.5-flash:generateContent \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"contents":[{"role":"user","parts":[{"text":"Hello"}]}]}'`);
  console.log(`\n💡 Use CLI for more options: npm run build && npx mock-openai-api --help`);
}); 
