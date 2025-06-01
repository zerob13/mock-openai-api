# Mock OpenAI API - Function Calls 功能指南

## 概述

本项目支持两种函数调用格式：

- `mock-gpt-function`: 支持新版OpenAI tool calls格式的模型

## 模型特点

### mock-gpt-function
- 使用新版 tool calls 格式
- 支持两阶段调用流程
- 第一阶段返回 tool_calls，第二阶段返回执行结果
- 完全兼容 OpenAI 最新的函数调用规范

## 命令行启动选项

支持以下命令行参数：

```bash
# 使用默认设置启动
npx mock-openai-api

# 指定端口和主机
npx mock-openai-api -p 8080 -H localhost

# 启用详细日志
npx mock-openai-api -v

# 查看所有选项
npx mock-openai-api --help
```

参数说明：
- `-p, --port <number>`: 服务器端口 (默认: 3000)
- `-H, --host <address>`: 服务器主机地址 (默认: 0.0.0.0)
- `-v, --verbose`: 启用请求日志输出到控制台 (默认: 关闭)

## 使用示例

### 基本调用 - mock-gpt-function

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-function",
    "messages": [
      {"role": "user", "content": "What time is it now?"}
    ],
    "stream": false
  }'
```

### 流式调用 - mock-gpt-function

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-function",
    "messages": [
      {"role": "user", "content": "What time is it now?"}
    ],
    "stream": true
  }'
```

### 启用详细日志的调用示例

```bash
# 启动服务器并启用日志
npx mock-openai-api -v -p 8080

# 发送请求 (在另一个终端)
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-gpt-function",
    "messages": [
      {"role": "user", "content": "Calculate 123 * 456"}
    ],
    "stream": false
  }'
```

## 支持的测试场景

mock-gpt-function 模型包含以下预设测试场景：

1. **获取当前时间**: `"What time is it now?"`
2. **天气查询**: `"What's the weather like in Beijing today?"`
3. **数学计算**: `"Help me calculate 123 multiplied by 456"`
4. **网络搜索**: `"Search for the latest AI news"`

## 响应格式

### Tool Calls 响应示例 (第一阶段)

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "mock-gpt-function",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_0_8a90fac8-b281-49a0-bcc9-55d7f4603891",
        "type": "function",
        "function": {
          "name": "get_time",
          "arguments": "{}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 10,
    "total_tokens": 20
  }
}
```

### 流式响应示例

对于流式调用，mock-gpt-function 会先返回 tool_calls，然后在第二阶段返回执行结果的分块内容。

## 测试文件

可以使用项目中的 `test-sse-client.html` 文件来测试流式响应：

```bash
# 启动服务器
npm run dev

# 在浏览器中打开 test-sse-client.html 文件
# 选择 mock-gpt-function 模型进行测试
```

## 开发说明

### 添加新的测试用例

如需添加新的 function call 测试用例，请在 `src/data/mockData.ts` 的 `functionTestCases` 数组中添加新的测试用例，格式如下：

```typescript
{
  name: "Test Case Name",
  description: "Test case description",
  prompt: "User input that triggers this test case",
  response: "", // First phase empty
  toolCall: {
    name: "function_name",
    arguments: {
      // function arguments
    },
    id: "unique_call_id"
  },
  toolCallResponse: "Function execution result",
  toolCallResponseChunks: [
    "Chunk 1",
    " Chunk 2",
    " Chunk 3"
  ]
}
```

### 文件结构

- `src/data/mockData.ts`: 包含所有测试用例数据
- `src/services/openaiService.ts`: 处理 API 请求逻辑
- `src/types/index.ts`: TypeScript 类型定义
- `src/cli.ts`: 命令行接口

可用模型: mock-gpt-thinking, mock-gpt-thinking-tag, mock-gpt-function, mock-gpt-markdown, gpt-4o-image 
