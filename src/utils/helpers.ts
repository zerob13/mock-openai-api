import { MockModel, MockTestCase } from '../types';
import { mockModels } from '../data/mockData';
import { getMappedModelName, getOriginalModelName } from '../config/modelMapping';

/**
 * Generate unique chat completion ID
 */
export function generateChatCompletionId(): string {
  return `chatcmpl-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate unique image ID
 */
export function generateImageId(): string {
  return `img-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get current timestamp
 */
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Find model by ID
 */
export function findModelById(modelId: string): MockModel | undefined {
  // First check if it's a direct match with original model ID
  let foundModel = mockModels.find(model => model.id === modelId);

  if (foundModel) {
    return foundModel;
  }

  // If not found, check if it's a mapped model name, get the original ID
  const originalModelId = getOriginalModelName(modelId);
  if (originalModelId) {
    return mockModels.find(model => model.id === originalModelId);
  }

  // Finally, try mapping the input and finding the model
  const mappedModelId = getMappedModelName(modelId);
  return mockModels.find(model => model.id === mappedModelId);
}

/**
 * Select the most matching test case based on user input
 */
export function selectTestCase(model: MockModel, userPrompt: string): MockTestCase {
  const prompt = userPrompt.toLowerCase().trim();

  // For markdown model, always return the first test case (the complete markdown example)
  if (model.type === 'markdown') {
    const idx = Math.floor(getCurrentTimestamp() % model.testCases.length)
    console.log('markdown model', idx);
    return model.testCases[idx];
  }

  // Number matching logic - broader matching, consider it a hit if it contains numbers
  const numberMatch = prompt.match(/(\d+)/);
  if (numberMatch) {
    const index = parseInt(numberMatch[1]) - 1; // Convert to 0-based index
    if (index >= 0 && index < model.testCases.length) {
      return model.testCases[index];
    }
    // Number out of range, return first test case instead of help
    return model.testCases[0];
  }

  // Direct matching of test case prompts
  for (const testCase of model.testCases) {
    if (testCase.prompt.toLowerCase().trim() === prompt) {
      return testCase;
    }
  }

  // Keyword matching
  const greetingKeywords = ['hello', 'hi', 'hey', 'greetings'];
  const mathKeywords = ['calculate', 'add', 'subtract', 'multiply', 'divide', '+', '-', '*', '/', 'math'];
  const programmingKeywords = ['python', 'javascript', 'code', 'programming', 'program', 'create', 'list'];
  const helpKeywords = ['help', '?', 'list', 'show'];

  // Help keyword matching - only show help for non-markdown models
  if (helpKeywords.some(keyword => prompt.includes(keyword))) {
    return createHelpTestCase(model);
  }

  if (greetingKeywords.some(keyword => prompt.includes(keyword))) {
    const greetingCase = model.testCases.find(tc =>
      greetingKeywords.some(kw => tc.prompt.toLowerCase().includes(kw)) ||
      tc.name.toLowerCase().includes('default') ||
      tc.name.toLowerCase().includes('reply')
    );
    if (greetingCase) return greetingCase;
  }

  if (mathKeywords.some(keyword => prompt.includes(keyword))) {
    const mathCase = model.testCases.find(tc =>
      mathKeywords.some(kw => tc.prompt.toLowerCase().includes(kw)) ||
      tc.name.toLowerCase().includes('math')
    );
    if (mathCase) return mathCase;
  }

  if (programmingKeywords.some(keyword => prompt.includes(keyword))) {
    const progCase = model.testCases.find(tc =>
      programmingKeywords.some(kw => tc.prompt.toLowerCase().includes(kw)) ||
      tc.name.toLowerCase().includes('programming')
    );
    if (progCase) return progCase;
  }

  // Default to first test case
  return model.testCases[0];
}

/**
 * Create help test case for model
 */
function createHelpTestCase(model: MockModel): MockTestCase {
  const caseList = model.testCases.map((testCase, index) =>
    `${index + 1}. ${testCase.name} - ${testCase.description}\n   Example: "${testCase.prompt}"`
  ).join('\n\n');

  const helpContent = `# ${model.name} Available Test Cases

The following are the test cases supported by the current model. You can:
- Enter content containing numbers to select corresponding test cases (like "1", "select 2nd", "I want 3", etc.)
- Enter related keywords for matching
- Enter example prompts directly

## Available Test Cases:

${caseList}

---

💡 **Usage Tips:**
- Enter any content containing numbers to select corresponding test cases (like "1", "2nd one", "select 3")
- Enter "help" or "?" to view this help information
- Enter specific prompt words for intelligent matching`;

  const helpCase: MockTestCase = {
    name: "Help Information",
    description: "Display all available test cases",
    prompt: "help",
    response: helpContent,
    streamChunks: [
      `# ${model.name} Available Test Cases\n\n`,
      `The following are the test cases supported by the current model. You can:\n`,
      `- Enter content containing numbers to select corresponding test cases (like "1", "select 2nd", "I want 3", etc.)\n`,
      `- Enter related keywords for matching\n`,
      `- Enter example prompts directly\n\n`,
      `## Available Test Cases:\n\n`,
      caseList,
      `\n\n---\n\n💡 **Usage Tips:**\n`,
      `- Enter any content containing numbers to select corresponding test cases (like "1", "2nd one", "select 3")\n`,
      `- Enter "help" or "?" to view this help information\n`,
      `- Enter specific prompt words for intelligent matching`
    ]
  };

  // If it's a thinking model, add reasoning_content
  if (model.type === 'thinking' || model.type === 'thinking-tag') {
    helpCase.reasoning_content = `User requested help information. I need to show them all available test cases for the current model ${model.name}, including instructions on how to quickly select through numbers.`;
    helpCase.reasoning_chunks = [
      "User requested",
      " help information.",
      " I need to show them",
      ` all available test cases for the current model ${model.name},`,
      " including instructions",
      " on how to quickly select",
      " through numbers."
    ].filter(chunk => chunk !== ''); // Filter empty strings
  }

  return helpCase;
}

/**
 * Calculate token count (simple estimation)
 */
export function calculateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Randomly select an item from array
 */
export function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Format error response
 */
export function formatErrorResponse(message: string): any {
  return {
    error: {
      message,
      type: 'invalid_request_error',
      code: 'invalid_model'
    }
  };
}

/**
 * 验证模型是否支持流式输出
 */
export function supportsStreaming(modelId: string): boolean {
  const model = findModelById(modelId);
  return model !== undefined;
}

/**
 * 延迟函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    global.setTimeout(resolve, ms);
  });
} 
