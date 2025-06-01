# Mock OpenAI API

[![NPM Version](https://img.shields.io/npm/v/mock-openai-api)](https://www.npmjs.com/package/mock-openai-api)
[![GitHub License](https://img.shields.io/github/license/zerob13/mock-openai-api)](https://github.com/zerob13/mock-openai-api/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express.js](https://img.shields.io/badge/Express.js-404D59?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![GitHub Stars](https://img.shields.io/github/stars/zerob13/mock-openai-api?style=social)](https://github.com/zerob13/mock-openai-api)
[![GitHub Forks](https://img.shields.io/github/forks/zerob13/mock-openai-api?style=social)](https://github.com/zerob13/mock-openai-api/fork)

*中文说明 | [English](README.md)*

一个完整的 OpenAI API 兼容的模拟服务器，无需调用真实的大模型，返回预定义的测试数据。非常适合开发、测试和调试使用 OpenAI API 的应用程序。

## 🚀 快速开始

### 安装

```bash
npm install -g mock-openai-api
```

### 启动服务器

```bash
npx mock-openai-api
```

服务器将在 `http://localhost:3000` 启动。

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

- ✅ **完整的 OpenAI API 兼容性**
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

### 2. mock-gpt-function
**函数调用模型** - 支持工具和函数调用

```json
{
  "model": "mock-gpt-function",
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

## 🧪 测试

### 使用 curl 测试

```bash
# 测试健康检查
curl http://localhost:3000/health

# 测试模型列表
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
    "model": "mock-gpt-function",
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

const client = new OpenAI({
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
