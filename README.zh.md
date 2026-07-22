# Mock OpenAI API

[![NPM Version](https://img.shields.io/npm/v/mock-openai-api)](https://www.npmjs.com/package/mock-openai-api)
[![GitHub License](https://img.shields.io/github/license/zerob13/mock-openai-api)](https://github.com/zerob13/mock-openai-api/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express.js](https://img.shields.io/badge/Express.js-404D59?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![GitHub Stars](https://img.shields.io/github/stars/zerob13/mock-openai-api?style=social)](https://github.com/zerob13/mock-openai-api)
[![GitHub Forks](https://img.shields.io/github/forks/zerob13/mock-openai-api?style=social)](https://github.com/zerob13/mock-openai-api/fork)

*中文说明 | [English](README.md)*

一个面向 OpenAI 与 Anthropic 常用协议的模拟服务器；内置/重放模式无需调用真实模型，可返回预定义或已录制的测试数据。

## 录制与重放后台

启动后会同时提供 Mock API `http://127.0.0.1:3000` 和管理后台 `http://127.0.0.1:3001`。后台可以切换内置、录制、重放模式，管理 capture 文件，编辑文本、Markdown、tool call、usage 和 error 场景，并在 OpenAI Chat、OpenAI Responses、Anthropic Messages 三种协议间转换重放。

录制模式会把原请求和原 key 透传给后台配置的 upstream。每次请求独立保存为经过凭据脱敏的 `.llmcap.jsonl`，记录请求、响应、原始 SSE read chunk、状态、headers 和相对时间。相同协议可按原始 bytes 与延迟重放；跨协议通过语义场景重放。

```bash
npm install
npm run build
npm start
```

支持 `POST /v1/chat/completions`、`POST /v1/responses`、`POST /v1/messages`。客户端只需保持 API key 不变，把 base URL 指向本服务。完整架构、文件格式、协议映射和安全边界见 [`docs/record-replay-implementation.md`](docs/record-replay-implementation.md)。

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
| `--admin-port <number>` |      | 管理后台端口         | `3001`    |
| `--admin-host <address>` |     | 管理后台监听地址     | `127.0.0.1` |
| `--admin-token <token>` |      | 管理后台 Bearer token；非 loopback 监听时必填 |  |
| `--data-dir <path>` | `-d` | 录制与场景目录           | `.mock-openai-api` |
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

服务器启动时会输出两个 listener 与数据目录：

```
Mock API: http://127.0.0.1:3000
Admin UI: http://127.0.0.1:3001
Data: /path/to/.mock-openai-api
```

### 基本使用

```bash
# 获取模型列表
curl http://localhost:3000/v1/models

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

- ✅ **兼容 OpenAI Chat、OpenAI Responses 与 Anthropic Messages 网关入口**
- ✅ **支持流式和非流式聊天完成**
- ✅ **支持函数调用**
- ✅ **支持图像生成**
- ✅ **预定义的测试场景**
- ✅ **TypeScript 编写**
- ✅ **易于集成和部署**
- ✅ **详细的错误处理**

## 📋 支持的 API 端点

### 模型管理
- `GET /v1/models` - 获取可用模型列表
- `GET /models` - 兼容端点

### 聊天完成
- `POST /v1/chat/completions` - 创建聊天完成
- `POST /chat/completions` - 兼容端点

### 图像生成
- `POST /v1/images/generations` - 生成图像
- `POST /images/generations` - 兼容端点

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
├── types/          # TypeScript 类型定义
├── data/           # 预定义的测试数据
├── utils/          # 工具函数
├── services/       # 业务逻辑服务
├── controllers/    # 路由控制器
├── routes/         # 路由定义
├── app.ts          # Express 应用设置
├── index.ts        # 服务器启动
└── cli.ts          # CLI 工具入口
```

### 添加新的测试场景

1. 在 `src/data/mockData.ts` 中添加新的测试用例
2. 可以为现有模型添加测试用例，或创建新的模型类型
3. 重新构建项目：`npm run build`

示例：

```typescript
const newTestCase: MockTestCase = {
  name: "新功能测试",
  description: "测试新功能的描述",
  prompt: "触发关键词",
  response: "预期的响应内容",
  streamChunks: ["分段", "流式", "内容"], // 可选
  functionCall: { // 可选，仅用于 function 类型模型
    name: "function_name",
    arguments: { param: "value" }
  }
};
```

## 🌐 部署

### Docker 部署

仓库内置多阶段 `Dockerfile` 和带持久化卷的 Compose 配置。默认容器只对外提供 Mock API；若暴露管理后台，必须设置仅保存在内存中的 token：

```bash
docker build -t mock-openai-api .
docker run -p 3000:3000 mock-openai-api

docker run -p 3000:3000 -p 127.0.0.1:3001:3001 \
  -e ADMIN_HOST=0.0.0.0 -e ADMIN_TOKEN=change-this-token \
  -v mock-openai-data:/data mock-openai-api

ADMIN_TOKEN=change-this-token docker compose up -d
```

### 环境变量

- `PORT` - 服务器端口（默认：3000）
- `HOST` - 服务器主机（默认：0.0.0.0）
- `ADMIN_PORT` - 管理后台端口（默认：3001）
- `ADMIN_HOST` - 管理后台监听地址（默认：127.0.0.1）
- `ADMIN_TOKEN` - 管理后台 Bearer token；非 loopback 监听时必填且不会持久化
- `DATA_DIR` - 录制与场景持久化目录（默认：`.mock-openai-api`）

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
