#!/usr/bin/env node

import { Command } from 'commander';
import app from './app';
import { version } from '../package.json'
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
  .parse();

const options = program.opts();

const PORT = parseInt(options.port) || 3000;
const HOST = options.host || '0.0.0.0';

// 设置全局变量控制日志输出
global.verboseLogging = options.verbose;

app.listen(PORT, HOST, () => {
  console.log(`🚀 Mock OpenAI API server started successfully!`);
  console.log(`📍 Server address: http://${HOST}:${PORT}`);
  console.log(`⚙️  Configuration:`);
  console.log(`   • Port: ${PORT}`);
  console.log(`   • Host: ${HOST}`);
  console.log(`   • Verbose logging: ${options.verbose ? 'ENABLED' : 'DISABLED'}`);
  console.log(`   • Version: ${version}`);
  console.log(`📖 API Documentation:`);
  console.log(`   • GET  /health - Health check`);
  console.log(`   • GET  /v1/models - Get model list`);
  console.log(`   • POST /v1/chat/completions - Chat completions`);
  console.log(`   • POST /v1/images/generations - Image generation`);
  console.log(`\n✨ Available models:`);
  console.log(`   - mock-gpt-thinking: Model supporting thought process`);
  console.log(`   - gpt-4-mock: Model supporting function calls`);
  console.log(`   - mock-gpt-markdown: Model outputting standard Markdown`);
  console.log(`   - gpt-4o-image: Model specifically for image generation`);
  console.log(`\n🔗 Usage example:`);
  console.log(`   curl -X POST http://localhost:${PORT}/v1/chat/completions \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{`);
  console.log(`       "model": "gpt-4-mock",`);
  console.log(`       "messages": [{"role": "user", "content": "Hello"}]`);
  console.log(`     }'`);
  console.log(`\n💡 CLI Options:`);
  console.log(`   • Use --help to see all available options`);
  console.log(`   • Use -v or --verbose to enable request logging`);
  console.log(`   • Use -p <port> to specify custom port`);
  console.log(`   • Use -H <host> to specify custom host address`);
}); 
