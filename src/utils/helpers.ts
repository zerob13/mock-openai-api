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
  // 简单的关键词匹配逻辑
  const prompt = userPrompt.toLowerCase();
  
  // 优先匹配关键词
  for (const testCase of model.testCases) {
    const keywords = [testCase.name.toLowerCase(), testCase.description.toLowerCase()];
    if (keywords.some(keyword => prompt.includes(keyword.split(' ')[0]))) {
      return testCase;
    }
  }
  
  // 如果没有匹配，返回第一个测试用例
  return model.testCases[0];
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
