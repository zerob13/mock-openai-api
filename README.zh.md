# Mock OpenAI API

[![NPM Version](https://img.shields.io/npm/v/mock-openai-api)](https://www.npmjs.com/package/mock-openai-api)
[![GitHub License](https://img.shields.io/github/license/zerob13/mock-openai-api)](https://github.com/zerob13/mock-openai-api/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express.js](https://img.shields.io/badge/Express.js-404D59?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![GitHub Stars](https://img.shields.io/github/stars/zerob13/mock-openai-api?style=social)](https://github.com/zerob13/mock-openai-api)
[![GitHub Forks](https://img.shields.io/github/forks/zerob13/mock-openai-api?style=social)](https://github.com/zerob13/mock-openai-api/fork)

*中文说明 | [English](README.md)*

一个完整的 OpenAI、Anthropic、Gemini API 兼容模拟服务器，无需调用真实的大模型，返回确定性的本地测试数据。非常适合开发、测试和调试使用多家 AI API 的应用程序。

## 🚀 快速开始

### 方法 1：公共服务（无需安装配置）

最快的使用方式是直接使用我们的公共部署服务：

**服务地址**: `https://mockllm.anya2a.com/v1`  
**API密钥**: `DeepChat`

```bash
# 测试公共服务
curl https://mockllm.anya2a.com/v1/models \
  -H "Authorization: Bearer DeepChat"

# 聊天完成示例
curl -X POST https://mockllm.anya2a.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer DeepChat" \
  -d '{
    "model": "mock-gpt-thinking",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

### 方法 2：NPM 安装（本地部署）

```bash
npm install -g mock-openai-api
```

### 启动服务器

```bash
npx mock-openai-api
```

服务器将在 `http://localhost:3000` 启动。

## ⚙️ CLI 选项

模拟服务器支持多种命令行选项进行自定义配置：

### 基本用法

```bash
# 使用默认设置启动
npx mock-openai-api

# 指定自定义端口启动
npx mock-openai-api -p 8080

# 指定自定义主机和端口
npx mock-openai-api -H localhost -p 8080

# 启用详细请求日志
npx mock-openai-api -v

# 组合多个选项
npx mock-openai-api -p 8080 -H 127.0.0.1 -v
```

### 可用选项

| 选项               | 简写 | 描述                     | 默认值    |
| ------------------ | ---- | ------------------------ | --------- |
| `--port <number>`  | `-p` | 服务器端口               | `3000`    |
| `--host <address>` | `-H` | 服务器主机地址           | `0.0.0.0` |
| `--verbose`        | `-v` | 启用请求日志输出到控制台 | `false`   |
| `--version`        |      | 显示版本号               |           |
| `--help`           |      | 显示帮助信息             |           |

### 使用示例

```bash
# 开发环境设置，启用详细日志
npx mock-openai-api -v -p 3001

# 生产环境设置
npx mock-openai-api -H 0.0.0.0 -p 80

# 本地测试设置
npx mock-openai-api -H localhost -p 8080 -v

# 查看版本
npx mock-openai-api --version

# 获取帮助
npx mock-openai-api --help
```

服务器启动时，会显示正在使用的配置：

```
🚀 Mock OpenAI API server started successfully!
📍 Server address: http://0.0.0.0:3000
⚙️  Configuration:
   • Port: 3000
   • Host: 0.0.0.0
   • Verbose logging: DISABLED
   • Config file: ./model-mapping.json
   • Version: 1.0.6
📖 API Documentation:
   OpenAI compatible:
   • POST /v1/responses - Responses API 创建/流式/tool calls
   • POST /v1/chat/completions - Chat Completions 创建/流式/tool calls
   • POST /v1/embeddings - 确定性 embeddings
   • POST /v1/files - 上传模拟文件
   Anthropic compatible:
   • POST /v1/messages - Messages 创建/流式/tool use/thinking
   • POST /v1/messages/count_tokens - Message token 统计
   Gemini compatible:
   • POST /v1beta/models/{model}:generateContent - GenerateContent
   • POST /upload/v1beta/files - 文件上传，兼容 SDK resumable upload
```

### 基本使用

```bash
# 获取模型列表
curl http://localhost:3000/v1/models

# Responses API
curl -X POST http://localhost:3000/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "input": "本地 agent harness 测试"
  }'

# 聊天完成（非流式）
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-thinking",
    "messages": [{"role": "user", "content": "你好"}]
  }'

# 聊天完成（流式）
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-thinking",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'

# 图像生成
curl -X POST http://localhost:3000/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-image",
    "prompt": "一只可爱的猫咪",
    "n": 1,
    "size": "1024x1024"
  }'
```

## 🎯 特性

- ✅ **完整的 OpenAI API 兼容性**
- ✅ **支持 Anthropic Claude API**
- ✅ **支持 Google Gemini API**
- ✅ **支持流式和非流式聊天完成**
- ✅ **支持函数调用**
- ✅ **支持图像生成**
- ✅ **预定义的测试场景**
- ✅ **TypeScript 编写**
- ✅ **易于集成和部署**
- ✅ **详细的错误处理**

## 📋 支持的 API 端点

### OpenAI 兼容端点
- `GET /v1/models` - 默认获取 OpenAI 兼容模型列表
- `GET /models` - 兼容端点
- `POST /v1/responses` - 创建确定性的 Responses API 响应
- `GET /v1/responses/{response_id}` - 获取已存储的响应
- `DELETE /v1/responses/{response_id}` - 删除已存储的响应
- `POST /v1/responses/{response_id}/cancel` - 取消排队/进行中的响应
- `GET /v1/responses/{response_id}/input_items` - 列出响应输入项
- `POST /v1/responses/input_tokens` - 统计响应输入 token
- `POST /v1/responses/compact` - 返回确定性的上下文压缩响应
- `POST /v1/chat/completions` - 创建聊天完成
- `GET /v1/chat/completions/{completion_id}` - 获取已存储的聊天完成
- `POST /v1/chat/completions/{completion_id}` - 更新聊天完成 metadata
- `DELETE /v1/chat/completions/{completion_id}` - 删除已存储的聊天完成
- `GET /v1/chat/completions/{completion_id}/messages` - 列出聊天消息
- `POST /chat/completions` - 兼容端点
- `POST /v1/images/generations` - 生成图像
- `POST /v1/images/edits` - 生成确定性的图像编辑结果
- `POST /v1/images/variations` - 生成确定性的图像变体结果
- `POST /images/generations` - 兼容端点
- `POST /v1/embeddings` - 创建确定性的 embedding 向量
- `POST /v1/files` - 上传模拟文件
- `GET /v1/files` - 列出模拟文件
- `GET /v1/files/{file_id}` - 获取模拟文件 metadata
- `DELETE /v1/files/{file_id}` - 删除模拟文件

### Anthropic 兼容端点
- `GET /v1/models` - 设置 `anthropic-version` 或 `x-provider: anthropic` 时返回 Anthropic 模型列表
- `GET /anthropic/v1/models` - 获取 Anthropic 模型列表
- `POST /v1/messages` - 创建 Claude 兼容消息
- `POST /anthropic/v1/messages` - 兼容消息端点
- `POST /v1/messages/count_tokens` - 统计 Claude 兼容消息 token
- `POST /v1/files` - 设置 Anthropic provider header 时上传 Anthropic 形状的模拟文件
- `GET /v1/files` - 设置 Anthropic provider header 时列出 Anthropic 形状的模拟文件
- `GET /v1/files/{file_id}` - 设置 Anthropic provider header 时获取文件 metadata
- `DELETE /v1/files/{file_id}` - 设置 Anthropic provider header 时删除文件

### Gemini 兼容端点
- `GET /v1/models` - 设置 `x-provider: gemini` 或 `?provider=gemini` 时返回 Gemini 模型列表
- `GET /v1beta/models` - 获取 Gemini 模型列表
- `POST /v1beta/models/{model}:generateContent` - 生成内容
- `POST /v1beta/models/{model}:streamGenerateContent` - 流式生成内容
- `POST /v1beta/models/{model}:countTokens` - 统计 Gemini 请求 token
- `POST /upload/v1beta/files` - 上传 Gemini 模拟文件
- `GET /v1beta/files` - 列出 Gemini 模拟文件
- `GET /v1beta/files/{name}` - 获取 Gemini 文件 metadata
- `DELETE /v1beta/files/{name}` - 删除 Gemini 模拟文件
- `POST /v1beta/cachedContents` - 创建 Gemini cached content
- `GET /v1beta/cachedContents` - 列出 Gemini cached contents
- `GET /v1beta/cachedContents/{name}` - 获取 Gemini cached content metadata
- `DELETE /v1beta/cachedContents/{name}` - 删除 Gemini cached content
- `GET /gemini/v1/models` - 旧版 Gemini 模型别名
- `POST /gemini/v1/models/{model}/generateContent` - 旧版 Gemini 生成别名
- `POST /gemini/v1/models/{model}/streamGenerateContent` - 旧版 Gemini 流式别名

### 健康检查
- `GET /health` - 服务器健康状态

## 🤖 可用模型

### 1. mock-gpt-thinking
**思考型模型** - 显示推理过程，适合调试逻辑

```json
{
  "model": "mock-gpt-thinking",
  "messages": [{"role": "user", "content": "计算 2+2"}]
}
```

响应会包含 `<thinking>` 标签显示思考过程。

### 2. gpt-4-mock
**函数调用模型** - 支持工具和函数调用

```json
{
  "model": "gpt-4-mock",
  "messages": [{"role": "user", "content": "今天北京的天气怎么样？"}],
  "functions": [
    {
      "name": "get_weather",
      "description": "获取天气信息",
      "parameters": {
        "type": "object",
        "properties": {
          "location": {"type": "string"},
          "date": {"type": "string"}
        }
      }
    }
  ]
}
```

### 3. mock-gpt-markdown
**Markdown 示例模型** - 专门输出标准 Markdown 格式的纯文本模型

```json
{
  "model": "mock-gpt-markdown",
  "messages": [{"role": "user", "content": "任何问题"}]
}
```

响应将是一个完整的 Markdown 文档，包含各种格式元素，适合前端 UI 调试。
**注意：** 此模型专注于内容展示，不支持函数调用功能，保持输出的纯净性。

### 4. gpt-4o-image
**图像生成模型** - 专门用于图像生成

```json
{
  "model": "gpt-4o-image",
  "prompt": "一只可爱的橘猫在阳光下玩耍",
  "n": 2,
  "size": "1024x1024",
  "quality": "hd"
}
```

支持多种尺寸和质量设置，返回高质量的模拟图像。

## 🛠️ 开发

### 本地开发

```bash
# 克隆项目
git clone https://github.com/zerob13/mock-openai-api.git
cd mock-openai-api

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建项目
npm run build

# 生产模式运行
npm start
```

### 项目结构

```
src/
├── core/           # 确定性场景、错误、状态、SSE、usage、校验
├── providers/      # OpenAI、Anthropic、Gemini 协议路由和服务
├── fixtures/       # provider fixture 示例
├── data/           # 旧版预定义测试数据
├── controllers/    # 旧版兼容 controller
├── routes/         # 路由注册
├── app.ts          # Express 应用设置
├── index.ts        # 服务器启动
└── cli.ts          # CLI 工具入口

test/
├── contract/       # 离线端点契约测试
├── unit/           # 核心确定性基础设施测试
└── sdk/            # 通过 RUN_SDK_TESTS=1 开启的 SDK smoke tests
```

### Mock 控制项与场景速查

默认响应都是确定性的，也可以用 mock 控制项指定场景：

| 控制项 | 位置 | 说明 |
| --- | --- | --- |
| `x-mock-scenario` / `mock_scenario` | header、query 或 JSON body | 强制场景，例如 `tool_call`、`parallel_tools`、`structured_json`、`refusal`、`rate_limit`、`invalid_request`。 |
| `x-mock-seed` | header | 固定生成 ID，便于重复测试。 |
| `x-mock-latency-ms` / `mock_latency_ms` | header、query 或 JSON body | 在 handler 执行前添加端点延迟，最大 30000 ms。 |
| `x-mock-stream-chunk-ms` / `mock_stream_chunk_ms` | header、query 或 JSON body | 为 provider SSE 帧之间添加延迟，用于测试流式客户端，最大 30000 ms。 |
| `x-mock-error` / `mock_error` | header 或 query | 注入 provider 形状的 `400`、`401`、`403`、`404`、`409`、`429`、`500`、`529` 错误。 |
| `x-mock-background` | header | 在支持的 OpenAI Responses 路由中创建 queued/background 响应。 |

常用场景：

```bash
# OpenAI Responses tool call
curl -X POST http://localhost:3000/v1/responses \
  -H "Content-Type: application/json" \
  -H "x-mock-scenario: tool_call" \
  -d '{"model":"gpt-4.1-mini","input":"查询订单 A100","tools":[{"type":"function","name":"get_order"}]}'

# Anthropic parallel tool use
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-mock-scenario: parallel_tools" \
  -d '{"model":"claude-sonnet-4-5","max_tokens":256,"messages":[{"role":"user","content":"查询订单和天气"}],"tools":[{"name":"get_order","input_schema":{"type":"object"}},{"name":"get_weather","input_schema":{"type":"object"}}]}'

# Gemini structured JSON
curl -X POST http://localhost:3000/v1beta/models/gemini-1.5-flash:generateContent \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"提取商品数据"}]}],"generationConfig":{"responseMimeType":"application/json","responseSchema":{"type":"OBJECT"}}}'

# 延迟流式分块
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-mock-stream-chunk-ms: 100" \
  -d '{"model":"gpt-4.1-mini","stream":true,"messages":[{"role":"user","content":"慢速流式输出"}]}'
```

### Fixture 贡献

Fixture 示例位于：

```txt
src/fixtures/openai/
src/fixtures/anthropic/
src/fixtures/gemini/
```

新增 fixture 时请保持离线、确定性：不要复制真实线上 provider payload，不做真实 API 调用，ID/时间戳要稳定，并为新增场景补充对应 contract 或 unit test。当前运行时响应主要由 provider service 生成，fixture 文件用于贡献示例和后续 fixture-store 扩展。

### 迁移说明

旧版端点会继续保留：`/models`、`/chat/completions`、`/images/generations`、`/anthropic/v1/models`、`/anthropic/v1/messages`、以及 `/gemini/v1/...` 别名仍然可用；新的 `/v1/...` 和 `/v1beta/...` provider 兼容端点会继续扩展。

## 🌐 部署

### Docker 部署

创建 `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

构建和运行：

```bash
docker build -t mock-openai-api .
docker run -p 3000:3000 mock-openai-api
```

### 环境变量

- `PORT` - 服务器端口（默认：3000）
- `HOST` - 服务器主机（默认：0.0.0.0）
- `MODEL_MAPPING_CONFIG` - 模型映射配置文件路径（默认：model-mapping.json）

### 模型映射配置

您可以通过创建 `model-mapping.json` 文件来自定义显示给用户的模型名称。这允许您将内部模型名称映射到外部名称，以提供更好的用户体验。

**示例 model-mapping.json:**
```json
{
  "mock-gpt-thinking": "gpt-4o-mini",
  "gpt-4-mock": "gpt-4-turbo",
  "mock-gpt-markdown": "gpt-4o",
  "gpt-4o-image": "dall-e-3",
  "mock-claude-markdown": "claude-3-opus-20240229",
  "gemini-1.5-pro": "gemini-2.0-pro-exp-2025-01-15",
  "gemini-1.5-flash": "gemini-2.0-flash-exp-2025-01-15",
  "gemini-pro": "gemini-pro-1.0",
  "gemini-pro-vision": "gemini-pro-vision-1.0"
}
```

**CLI 使用:**
```bash
# 使用自定义模型映射配置
npx mock-openai-api -c custom-mapping.json

# 或通过环境变量设置
MODEL_MAPPING_CONFIG=custom-mapping.json npx mock-openai-api
```

服务器将自动加载配置并在控制台输出和 API 响应中显示映射后的模型名称。

## 🧪 测试

### 使用 curl 测试

```bash
# 测试公共服务
curl https://mockllm.anya2a.com/health
curl https://mockllm.anya2a.com/v1/models \
  -H "Authorization: Bearer DeepChat"

# 测试本地服务
curl http://localhost:3000/health
curl http://localhost:3000/v1/models

# 测试思考型模型
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-thinking",
    "messages": [{"role": "user", "content": "解释一下递归"}]
  }'

# 测试函数调用
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4-mock",
    "messages": [{"role": "user", "content": "现在几点了？"}]
  }'

# 测试 Markdown 输出
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-markdown",
    "messages": [{"role": "user", "content": "任何内容"}]
  }'

# 测试流式输出
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-thinking",
    "messages": [{"role": "user", "content": "讲个故事"}],
    "stream": true
  }'

# 测试图像生成
curl -X POST http://localhost:3000/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-image",
    "prompt": "一只可爱的橘猫",
    "n": 2,
    "size": "1024x1024"
  }'
```

### 使用 OpenAI SDK 测试

本地 SDK smoke tests 默认跳过，只有显式开启时才运行：

```bash
npm test
RUN_SDK_TESTS=1 npm test -- test/sdk
```

```javascript
import OpenAI from 'openai';

// 使用公共服务
const client = new OpenAI({
  baseURL: 'https://mockllm.anya2a.com/v1',
  apiKey: 'DeepChat'
});

// 或使用本地部署
const localClient = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'mock-key' // 可以是任意值
});

// 测试聊天完成
const completion = await client.chat.completions.create({
  model: 'mock-gpt-thinking',
  messages: [{ role: 'user', content: '你好' }]
});

console.log(completion.choices[0].message.content);

// 测试流式聊天
const stream = await client.chat.completions.create({
  model: 'mock-gpt-thinking',
  messages: [{ role: 'user', content: '你好' }],
  stream: true
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);
}

// 测试图像生成
const image = await client.images.generate({
  model: 'gpt-4o-image',
  prompt: '一只可爱的橘猫',
  n: 1,
  size: '1024x1024'
});

console.log(image.data[0].url);
```

### 使用 Anthropic SDK 测试

```javascript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  baseURL: 'http://localhost:3000',
  apiKey: 'mock-key'
});

const message = await anthropic.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 256,
  messages: [{ role: 'user', content: '你好' }],
  tools: [{ name: 'get_order', input_schema: { type: 'object' } }]
});

console.log(message.content);
```

### 使用 Google GenAI SDK 测试

```javascript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: 'mock-key',
  httpOptions: {
    baseUrl: 'http://localhost:3000',
    apiVersion: 'v1beta'
  }
});

const response = await ai.models.generateContent({
  model: 'gemini-1.5-flash',
  contents: '你好'
});

console.log(response.text);

const file = await ai.files.upload({
  file: new Blob(['mock file'], { type: 'text/plain' }),
  config: { mimeType: 'text/plain', displayName: 'mock.txt' }
});

console.log(file.uri);
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建特性分支：`git checkout -b feature/AmazingFeature`
3. 提交更改：`git commit -m 'Add some AmazingFeature'`
4. 推送到分支：`git push origin feature/AmazingFeature`
5. 提交 Pull Request

## 📄 许可证

本项目使用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 🔗 相关链接

- [OpenAI API 文档](https://platform.openai.com/docs/api-reference)
- [Express.js](https://expressjs.com/)
- [TypeScript](https://www.typescriptlang.org/)

## 💡 使用场景

- **前端开发**: 无需等待后端 API，快速开发和测试 AI 功能
- **API 集成测试**: 验证应用程序与 OpenAI API 的集成
- **演示和原型**: 创建不依赖真实 AI 服务的演示
- **开发调试**: 调试流式响应、函数调用等复杂场景
- **成本控制**: 避免开发阶段的 API 调用费用
- **离线开发**: 在没有网络的情况下开发 AI 应用

## 🎉 结语

Mock OpenAI API 让您能够快速、可靠地开发和测试 AI 应用，无需担心 API 配额、网络连接或费用问题。开始您的 AI 应用开发之旅吧！ 
