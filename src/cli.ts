#!/usr/bin/env node

import { Command } from 'commander';
import app from './app';
import { version } from '../package.json'
import { loadModelMapping, getMappedModelName } from './config/modelMapping';
// 扩展全局对象类型
declare global {
  var verboseLogging: boolean;
}

const program = new Command();

program
  .name('mock-openai-api')
  .description('Mock OpenAI Compatible Provider API server')
  .version(version)
  .option('-p, --port <number>', 'Server port', '3000')
  .option('-H, --host <address>', 'Server host address', '0.0.0.0')
  .option('-v, --verbose', 'Enable request logging to console', false)
  .option('-c, --config <path>', 'Path to model mapping config file', './model-mapping.json')
  .parse();

const options = program.opts();

const PORT = parseInt(options.port) || 3000;
const HOST = options.host || '0.0.0.0';

// 设置全局变量控制日志输出
global.verboseLogging = options.verbose;

// Load model mapping configuration
loadModelMapping(options.config);

app.listen(PORT, HOST, () => {
  console.log(`🚀 Mock OpenAI API server started successfully!`);
  console.log(`📍 Server address: http://${HOST}:${PORT}`);
  console.log(`⚙️  Configuration:`);
  console.log(`   • Port: ${PORT}`);
  console.log(`   • Host: ${HOST}`);
  console.log(`   • Verbose logging: ${options.verbose ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   • Config file: ${options.config}`);
  console.log(`   • Version: ${version}`);
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
  console.log(`   - ${getMappedModelName('gpt-4-mock')}: Model supporting function calls`);
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
  console.log(`\n💡 CLI Options:`);
  console.log(`   • Use --help to see all available options`);
  console.log(`   • Use -v or --verbose to enable request logging`);
  console.log(`   • Use -p <port> to specify custom port`);
  console.log(`   • Use -H <host> to specify custom host address`);
  console.log(`   • Use -c <path> to specify custom config file`);
}); 
