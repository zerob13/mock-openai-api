import { MockModel } from "../types";
import { markdownTestCases, functionTestCases } from './testCases';

export const geminiMockModels: MockModel[] = [
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    description: "Google's most advanced multimodal AI model with enhanced reasoning capabilities",
    type: "thinking",
    testCases: markdownTestCases
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    description: "Fast and efficient model for quick responses",
    type: "markdown",
    testCases: markdownTestCases
  },
  {
    id: "gemini-pro",
    name: "Gemini Pro",
    description: "Versatile model for various tasks including text generation and analysis",
    type: "function",
    testCases: functionTestCases
  },
  {
    id: "gemini-pro-vision",
    name: "Gemini Pro Vision",
    description: "Multimodal model capable of understanding both text and images",
    type: "image",
    testCases: markdownTestCases
  }
];