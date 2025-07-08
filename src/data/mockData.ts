import { MockModel, MockTestCase } from '../types';
import { thinkingTestCases, functionTestCases, markdownTestCases } from './testCases';


// Predefined model list
export const mockModels: MockModel[] = [
  {
    id: "mock-gpt-thinking",
    name: "Mock GPT Thinking Mode",
    description: "Model that supports displaying thinking process, suitable for debugging reasoning logic",
    type: "thinking",
    testCases: thinkingTestCases
  },
  {
    id: "mock-gpt-thinking-tag",
    name: "Mock GPT Thinking Tag Mode",
    description: "Model that supports displaying thinking process using <think> tags in content",
    type: "thinking-tag",
    testCases: thinkingTestCases
  },
  {
    id: "gpt-4-mock",
    name: "Mock GPT Function Calling",
    description: "Model that supports function calling with OpenAI tool calls format, suitable for testing tool integration and two-phase call workflows",
    type: "tool-calls",
    testCases: functionTestCases
  },
  {
    id: "mock-gpt-markdown",
    name: "Mock GPT Markdown Sample",
    description: "Pure text model specialized in outputting standard Markdown format, does not support function calling, focuses on content display and UI debugging",
    type: "markdown",
    testCases: markdownTestCases
  },
  {
    id: "gpt-4o-image",
    name: "GPT-4O Image Generation",
    description: "Model specialized for image generation, supports various sizes and styles",
    type: "image",
    testCases: [{
      name: "Image Generation Example",
      description: "Generate high-quality images",
      prompt: "Any image description",
      response: "I have generated the image for you."
    }]
  }
];

// Mock data for image generation
export const mockImageUrls = [
  "https://placehold.co/1024x1024/FF6B6B/FFFFFF?text=Mock+Image+1",
  "https://placehold.co/1024x1024/4ECDC4/FFFFFF?text=Mock+Image+2",
  "https://placehold.co/1024x1024/45B7D1/FFFFFF?text=Mock+Image+3",
  "https://placehold.co/1024x1024/96CEB4/FFFFFF?text=Mock+Image+4",
  "https://placehold.co/1024x1024/FFEAA7/000000?text=Mock+Image+5"
]; 
