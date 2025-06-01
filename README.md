# Mock OpenAI API

[![NPM Version](https://img.shields.io/npm/v/mock-openai-api)](https://www.npmjs.com/package/mock-openai-api)
[![GitHub License](https://img.shields.io/github/license/zerob13/mock-openai-api)](https://github.com/zerob13/mock-openai-api/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express.js](https://img.shields.io/badge/Express.js-404D59?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![GitHub Stars](https://img.shields.io/github/stars/zerob13/mock-openai-api?style=social)](https://github.com/zerob13/mock-openai-api)
[![GitHub Forks](https://img.shields.io/github/forks/zerob13/mock-openai-api?style=social)](https://github.com/zerob13/mock-openai-api/fork)

*[中文说明](README.zh.md) | English*

A complete OpenAI API compatible mock server that returns predefined test data without calling real LLMs. Perfect for developing, testing, and debugging applications that use the OpenAI API.

## 🚀 Quick Start

### Installation

```bash
npm install -g mock-openai-api
```

### Start Server

```bash
npx mock-openai-api
```

The server will start at `http://localhost:3000`.

### Basic Usage

```bash
# Get model list
curl http://localhost:3000/v1/models

# Chat completion (non-streaming)
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-thinking",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Chat completion (streaming)
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-thinking",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'

# Image generation
curl -X POST http://localhost:3000/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-image",
    "prompt": "A cute orange cat",
    "n": 1,
    "size": "1024x1024"
  }'
```

## 🎯 Features

- ✅ **Full OpenAI API Compatibility**
- ✅ **Support for streaming and non-streaming chat completions**
- ✅ **Function calling support**
- ✅ **Image generation support**
- ✅ **Predefined test scenarios**
- ✅ **Written in TypeScript**
- ✅ **Easy integration and deployment**
- ✅ **Detailed error handling**

## 📋 Supported API Endpoints

### Model Management
- `GET /v1/models` - Get available model list
- `GET /models` - Compatible endpoint

### Chat Completions
- `POST /v1/chat/completions` - Create chat completion
- `POST /chat/completions` - Compatible endpoint

### Image Generation
- `POST /v1/images/generations` - Generate images
- `POST /images/generations` - Compatible endpoint

### Health Check
- `GET /health` - Server health status

## 🤖 Available Models

### 1. mock-gpt-thinking
**Thinking Model** - Shows reasoning process, perfect for debugging logic

```json
{
  "model": "mock-gpt-thinking",
  "messages": [{"role": "user", "content": "Calculate 2+2"}]
}
```

Response will include `<thinking>` tags showing the reasoning process.

### 2. mock-gpt-function
**Function Calling Model** - Supports tools and function calling

```json
{
  "model": "mock-gpt-function",
  "messages": [{"role": "user", "content": "What's the weather like in Beijing today?"}],
  "functions": [
    {
      "name": "get_weather",
      "description": "Get weather information",
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
**Markdown Sample Model** - Outputs standard Markdown format plain text

```json
{
  "model": "mock-gpt-markdown",
  "messages": [{"role": "user", "content": "Any question"}]
}
```

Response will be a complete Markdown document with various formatting elements, perfect for frontend UI debugging.
**Note:** This model focuses on content display and doesn't support function calling to maintain output purity.

### 4. gpt-4o-image
**Image Generation Model** - Specialized for image generation

```json
{
  "model": "gpt-4o-image",
  "prompt": "A cute orange cat playing in sunlight",
  "n": 2,
  "size": "1024x1024",
  "quality": "hd"
}
```

Supports various sizes and quality settings, returns high-quality simulated images.

## 🛠️ Development

### Local Development

```bash
# Clone project
git clone https://github.com/zerob13/mock-openai-api.git
cd mock-openai-api

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build project
npm run build

# Run in production mode
npm start
```

### Project Structure

```
src/
├── types/          # TypeScript type definitions
├── data/           # Predefined test data
├── utils/          # Utility functions
├── services/       # Business logic services
├── controllers/    # Route controllers
├── routes/         # Route definitions
├── app.ts          # Express app setup
├── index.ts        # Server startup
└── cli.ts          # CLI tool entry
```

### Adding New Test Scenarios

1. Add new test cases in `src/data/mockData.ts`
2. You can add test cases for existing models or create new model types
3. Rebuild the project: `npm run build`

Example:

```typescript
const newTestCase: MockTestCase = {
  name: "New Feature Test",
  description: "Description of new feature test",
  prompt: "trigger keyword",
  response: "Expected response content",
  streamChunks: ["chunked", "streaming", "content"], // optional
  functionCall: { // optional, only for function type models
    name: "function_name",
    arguments: { param: "value" }
  }
};
```

## 🌐 Deployment

### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

Build and run:

```bash
docker build -t mock-openai-api .
docker run -p 3000:3000 mock-openai-api
```

### Environment Variables

- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)

## 🧪 Testing

### Testing with curl

```bash
# Test health check
curl http://localhost:3000/health

# Test model list
curl http://localhost:3000/v1/models

# Test thinking model
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-thinking",
    "messages": [{"role": "user", "content": "Explain recursion"}]
  }'

# Test function calling
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-function",
    "messages": [{"role": "user", "content": "What time is it now?"}]
  }'

# Test Markdown output
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-markdown",
    "messages": [{"role": "user", "content": "Any content"}]
  }'

# Test streaming output
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-thinking",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'

# Test image generation
curl -X POST http://localhost:3000/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-image",
    "prompt": "A cute orange cat",
    "n": 2,
    "size": "1024x1024"
  }'
```

### Testing with OpenAI SDK

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'mock-key' // can be any value
});

// Test chat completion
const completion = await client.chat.completions.create({
  model: 'mock-gpt-thinking',
  messages: [{ role: 'user', content: 'Hello' }]
});

console.log(completion.choices[0].message.content);

// Test streaming chat
const stream = await client.chat.completions.create({
  model: 'mock-gpt-thinking',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);
}

// Test image generation
const image = await client.images.generate({
  model: 'gpt-4o-image',
  prompt: 'A cute orange cat',
  n: 1,
  size: '1024x1024'
});

console.log(image.data[0].url);
```

## 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork this project
2. Create a feature branch: `git checkout -b feature/AmazingFeature`
3. Commit your changes: `git commit -m 'Add some AmazingFeature'`
4. Push to the branch: `git push origin feature/AmazingFeature`
5. Submit a Pull Request

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## 🔗 Related Links

- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
- [Express.js](https://expressjs.com/)
- [TypeScript](https://www.typescriptlang.org/)

## 💡 Use Cases

- **Frontend Development**: Rapidly develop and test AI features without waiting for backend API
- **API Integration Testing**: Verify application integration with OpenAI API
- **Demos and Prototypes**: Create demos that don't depend on real AI services
- **Development Debugging**: Debug streaming responses, function calls, and other complex scenarios
- **Cost Control**: Avoid API call costs during development phase
- **Offline Development**: Develop AI applications without internet connection

## 🎉 Conclusion

Mock OpenAI API enables you to quickly and reliably develop and test AI applications without worrying about API quotas, network connections, or costs. Start your AI application development journey today!