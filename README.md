# Mock OpenAI API

[![NPM Version](https://img.shields.io/npm/v/mock-openai-api)](https://www.npmjs.com/package/mock-openai-api)
[![Docker Pulls](https://img.shields.io/docker/pulls/zerob13/mock-openai-api)](https://hub.docker.com/r/zerob13/mock-openai-api)
[![Docker Image Size](https://img.shields.io/docker/image-size/zerob13/mock-openai-api/latest)](https://hub.docker.com/r/zerob13/mock-openai-api)
[![GitHub License](https://img.shields.io/github/license/zerob13/mock-openai-api)](https://github.com/zerob13/mock-openai-api/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express.js](https://img.shields.io/badge/Express.js-404D59?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![GitHub Stars](https://img.shields.io/github/stars/zerob13/mock-openai-api?style=social)](https://github.com/zerob13/mock-openai-api)
[![GitHub Forks](https://img.shields.io/github/forks/zerob13/mock-openai-api?style=social)](https://github.com/zerob13/mock-openai-api/fork)

*[中文说明](README.zh.md) | English*

A complete OpenAI API compatible mock server that returns predefined test data without calling real LLMs. Perfect for developing, testing, and debugging applications that use the OpenAI API.

## 🚀 Quick Start

### Method 1: Docker (Recommended)

The easiest way to run Mock OpenAI API is using Docker from [Docker Hub](https://hub.docker.com/r/zerob13/mock-openai-api):

```bash
# Pull and run the latest image
docker run -p 3000:3000 zerob13/mock-openai-api:latest

# Run with custom port
docker run -p 8080:3000 zerob13/mock-openai-api:latest

# Run with verbose logging
docker run -p 3000:3000 -e VERBOSE=true zerob13/mock-openai-api:latest

# Run in background (detached mode)
docker run -d -p 3000:3000 --name mock-openai-api zerob13/mock-openai-api:latest

# Run with timezone setting
docker run -p 3000:3000 -e TZ=Asia/Shanghai zerob13/mock-openai-api:latest
```

Available environment variables:
- `PORT`: Server port (default: 3000)
- `HOST`: Server host (default: 0.0.0.0)  
- `VERBOSE`: Enable verbose logging (default: false)
- `TZ`: Timezone setting (default: UTC)
- `NODE_ENV`: Node.js environment (default: production)

### Method 2: Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: '3.8'
services:
  mock-openai-api:
    image: zerob13/mock-openai-api:latest
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - HOST=0.0.0.0
      - VERBOSE=false
    restart: unless-stopped
```

Then run:

```bash
docker-compose up -d
```

### Method 3: NPM Installation

```bash
npm install -g mock-openai-api
```

### Start Server

```bash
npx mock-openai-api
```

The server will start at `http://localhost:3000`.

## ⚙️ CLI Options

The mock server supports various command line options for customization:

### Basic Usage

```bash
# Start with default settings
npx mock-openai-api

# Start on custom port
npx mock-openai-api -p 8080

# Start on custom host and port
npx mock-openai-api -H localhost -p 8080

# Enable verbose request logging
npx mock-openai-api -v

# Combine multiple options
npx mock-openai-api -p 8080 -H 127.0.0.1 -v
```

### Available Options

| Option             | Short | Description                       | Default   |
| ------------------ | ----- | --------------------------------- | --------- |
| `--port <number>`  | `-p`  | Server port                       | `3000`    |
| `--host <address>` | `-H`  | Server host address               | `0.0.0.0` |
| `--verbose`        | `-v`  | Enable request logging to console | `false`   |
| `--version`        |       | Show version number               |           |
| `--help`           |       | Show help information             |           |

### Examples

```bash
# Development setup with verbose logging
npx mock-openai-api -v -p 3001

# Production-like setup
npx mock-openai-api -H 0.0.0.0 -p 80

# Local testing setup
npx mock-openai-api -H localhost -p 8080 -v

# Check version
npx mock-openai-api --version

# Get help
npx mock-openai-api --help
```

When the server starts, it will display the configuration being used:

```
🚀 Mock OpenAI API server started successfully!
📍 Server address: http://0.0.0.0:3000
⚙️  Configuration:
   • Port: 3000
   • Host: 0.0.0.0
   • Verbose logging: DISABLED
   • Version: 1.0.1
```

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
- ✅ **Docker support with multi-arch images (AMD64/ARM64)**
- ✅ **Easy integration and deployment**
- ✅ **Detailed error handling**
- ✅ **Health check endpoint**

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

### 2. gpt-4-mock
**Function Calling Model** - Supports tools and function calling

```json
{
  "model": "gpt-4-mock",
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

### Docker Hub

Pre-built Docker images are available on Docker Hub and automatically updated with each release:

```bash
# Latest stable version
docker pull zerob13/mock-openai-api:latest

# Specific version
docker pull zerob13/mock-openai-api:v1.0.1

# Run the container
docker run -d -p 3000:3000 --name mock-openai-api zerob13/mock-openai-api:latest
```

### Production Deployment

```bash
# Production deployment with custom configuration
docker run -d \
  --name mock-openai-api \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e HOST=0.0.0.0 \
  zerob13/mock-openai-api:latest

# Health check
curl http://localhost:3000/health
```

### Docker Compose (Production Ready)

```yaml
version: '3.8'
services:
  mock-openai-api:
    image: zerob13/mock-openai-api:latest
    container_name: mock-openai-api
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
      - VERBOSE=false
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (res) => { res.statusCode === 200 ? process.exit(0) : process.exit(1); }).on('error', () => process.exit(1));"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Build from Source

If you want to build the Docker image yourself:

```bash
# Clone the repository
git clone https://github.com/zerob13/mock-openai-api.git
cd mock-openai-api

# Build the image
docker build -t my-mock-openai-api .

# Run your custom build
docker run -p 3000:3000 my-mock-openai-api
```

### Environment Variables

- `NODE_ENV` - Node environment (default: production)
- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `VERBOSE` - Enable verbose logging (default: false)

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
    "model": "gpt-4-mock",
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