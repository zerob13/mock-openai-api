import { MockModel, MockTestCase } from '../types';
import { mockModels } from '../data/mockData';

/**
 * 生成唯一的聊天完成 ID
 */
export function generateChatCompletionId(): string {
  return `chatcmpl-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 生成唯一的图像生成 ID
 */
export function generateImageId(): string {
  return `img-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取当前时间戳
 */
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 根据模型 ID 查找模型
 */
export function findModelById(modelId: string): MockModel | undefined {
  return mockModels.find(model => model.id === modelId);
}

/**
 * 根据用户输入选择最匹配的测试用例
 */
export function selectTestCase(model: MockModel, userPrompt: string): MockTestCase {
  const prompt = userPrompt.toLowerCase().trim();
  
  // 数字匹配逻辑 - 更宽泛的匹配，只要包含数字就认为命中
  const numberMatch = prompt.match(/(\d+)/);
  if (numberMatch) {
    const index = parseInt(numberMatch[1]) - 1; // 转换为0基索引
    if (index >= 0 && index < model.testCases.length) {
      return model.testCases[index];
    }
    // 数字超出范围，返回帮助信息
    return createHelpTestCase(model, userPrompt);
  }
  
  // 直接匹配测试用例的prompt
  for (const testCase of model.testCases) {
    if (testCase.prompt.toLowerCase().trim() === prompt) {
      return testCase;
    }
  }
  
  // 关键词匹配
  const greetingKeywords = ['你好', 'hello', 'hi', '您好'];
  const mathKeywords = ['计算', '加', '减', '乘', '除', '+', '-', '*', '/', 'calculate', 'math'];
  const programmingKeywords = ['python', 'javascript', 'code', '代码', '编程', '程序'];
  const helpKeywords = ['help', '帮助', '?', '？', 'list'];
  
  // 帮助关键词匹配
  if (helpKeywords.some(keyword => prompt.includes(keyword))) {
    return createHelpTestCase(model, userPrompt);
  }
  
  if (greetingKeywords.some(keyword => prompt.includes(keyword))) {
    const greetingCase = model.testCases.find(tc => 
      greetingKeywords.some(kw => tc.prompt.toLowerCase().includes(kw)) ||
      tc.name.toLowerCase().includes('默认') ||
      tc.name.toLowerCase().includes('回复')
    );
    if (greetingCase) return greetingCase;
  }
  
  if (mathKeywords.some(keyword => prompt.includes(keyword))) {
    const mathCase = model.testCases.find(tc => 
      mathKeywords.some(kw => tc.prompt.toLowerCase().includes(kw)) ||
      tc.name.toLowerCase().includes('数学')
    );
    if (mathCase) return mathCase;
  }
  
  if (programmingKeywords.some(keyword => prompt.includes(keyword))) {
    const progCase = model.testCases.find(tc => 
      programmingKeywords.some(kw => tc.prompt.toLowerCase().includes(kw)) ||
      tc.name.toLowerCase().includes('编程')
    );
    if (progCase) return progCase;
  }
  
  // 如果没有匹配，返回帮助信息
  return createHelpTestCase(model, userPrompt);
}

/**
 * 为模型创建帮助测试用例
 */
function createHelpTestCase(model: MockModel, userInput?: string): MockTestCase {
  const caseList = model.testCases.map((testCase, index) => 
    `${index + 1}. ${testCase.name} - ${testCase.description}\n   示例: "${testCase.prompt}"`
  ).join('\n\n');
  
  const userInputSection = userInput ? `## 您的输入：\n"${userInput}"\n\n` : '';
  
  const helpContent = `# ${model.name} 可用测试用例

${userInputSection}以下是当前模型支持的测试用例，您可以：
- 输入包含数字的内容选择对应的测试用例（如"1"、"选择第2个"、"我要3"等）
- 输入相关关键词进行匹配
- 直接输入示例提示词

## 可用测试用例：

${caseList}

---

💡 **使用提示：**
- 输入任何包含数字的内容选择对应测试用例（如"1"、"第2个"、"选3"）
- 输入 "help" 或 "帮助" 查看此帮助信息
- 输入具体的提示词进行智能匹配`;

  const helpCase: MockTestCase = {
    name: "帮助信息",
    description: "显示所有可用的测试用例",
    prompt: "help",
    response: helpContent,
    streamChunks: [
      `# ${model.name} 可用测试用例\n\n`,
      userInputSection,
      `以下是当前模型支持的测试用例，您可以：\n`,
      `- 输入包含数字的内容选择对应的测试用例（如"1"、"选择第2个"、"我要3"等）\n`,
      `- 输入相关关键词进行匹配\n`,
      `- 直接输入示例提示词\n\n`,
      `## 可用测试用例：\n\n`,
      caseList,
      `\n\n---\n\n💡 **使用提示：**\n`,
      `- 输入任何包含数字的内容选择对应测试用例（如"1"、"第2个"、"选3"）\n`,
      `- 输入 "help" 或 "帮助" 查看此帮助信息\n`,
      `- 输入具体的提示词进行智能匹配`
    ]
  };

  // 如果是思考模型，添加reasoning_content
  if (model.type === 'thinking' || model.type === 'thinking-tag') {
    const userInputReasoning = userInput ? `用户输入了："${userInput}"。` : '';
    helpCase.reasoning_content = `${userInputReasoning}用户请求查看帮助信息。我需要为他们展示当前模型${model.name}的所有可用测试用例，包括如何通过数字快速选择的说明。`;
    helpCase.reasoning_chunks = [
      userInput ? `用户输入了："${userInput}"。` : '',
      "用户请求查看",
      "帮助信息。",
      "我需要为他们展示",
      `当前模型${model.name}`,
      "的所有可用测试用例，",
      "包括如何通过数字",
      "快速选择的说明。"
    ].filter(chunk => chunk !== ''); // 过滤空字符串
  }

  return helpCase;
}

/**
 * 计算 token 数量（简化计算）
 */
export function calculateTokens(text: string): number {
  // 简化的 token 计算：大约每 4 个字符 = 1 token
  return Math.ceil(text.length / 4);
}

/**
 * 延迟函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    global.setTimeout(resolve, ms);
  });
}

/**
 * 随机选择数组中的元素
 */
export function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * 验证模型是否支持流式输出
 */
export function supportsStreaming(modelId: string): boolean {
  const model = findModelById(modelId);
  return model !== undefined;
}

/**
 * 格式化错误响应
 */
export function formatErrorResponse(message: string, type: string = 'invalid_request_error') {
  return {
    error: {
      message,
      type,
      param: null,
      code: null
    }
  };
} 
