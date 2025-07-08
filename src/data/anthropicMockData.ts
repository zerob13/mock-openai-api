import { MockModel } from "../types";
import { markdownTestCases } from './testCases';

export const anthropicMockModels: MockModel[] = [
  {
    id: "mock-claude-markdown",
    name: "Mock Claude Markdown Sample",
    description: "Pure text model specialized in outputting standard Markdown format, does not support function calling, focuses on content display and UI debugging",
    type: "markdown",
    testCases: markdownTestCases
  }
]
