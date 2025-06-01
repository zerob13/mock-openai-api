import { MockModel, MockTestCase } from '../types';

// Thinking model test cases
const thinkingTestCases: MockTestCase[] = [
  {
    name: "Math Problem",
    description: "Solve complex math problems",
    prompt: "Calculate 2+2",
    reasoning_content: "This is a simple addition problem. I need to calculate 2 + 2. 2 + 2 = 4. This is basic arithmetic.",
    reasoning_chunks: [
      "This is a simple",
      " addition problem.",
      " I need to calculate",
      " 2 + 2.",
      " 2 + 2 = 4.",
      " This is basic",
      " arithmetic."
    ],
    response: "2 + 2 = 4\n\nThis is a basic addition operation.",
    streamChunks: [
      "2 + 2 = 4",
      "\n\nThis is a",
      " basic",
      " addition operation."
    ]
  },
  {
    name: "Programming Question",
    description: "Code problem solving",
    prompt: "How to create a list in Python?",
    reasoning_content: "The user is asking how to create a list in Python. This is a basic Python question. There are several ways to create lists in Python: 1. Using square brackets [] 2. Using the list() constructor 3. Using list comprehension. I should provide clear examples.",
    reasoning_chunks: [
      "The user is asking how to",
      " create a list in Python.",
      " This is a basic",
      " Python question.",
      " There are several ways",
      " to create lists:",
      " 1. Using square brackets []",
      " 2. Using the list()",
      " constructor",
      " 3. Using list comprehension.",
      " I should provide",
      " clear examples."
    ],
    response: `There are several ways to create lists in Python:

1. **Empty list**:
   \`\`\`python
   my_list = []
   \`\`\`

2. **List with initial values**:
   \`\`\`python
   my_list = [1, 2, 3, 4, 5]
   \`\`\`

3. **Using list() constructor**:
   \`\`\`python
   my_list = list()
   \`\`\`

4. **List comprehension**:
   \`\`\`python
   my_list = [x for x in range(10)]
   \`\`\``,
    streamChunks: [
      "There are several ways to create lists",
      " in Python:\n\n",
      "1. **Empty list**:\n   ```python\n",
      "   my_list = []\n   ```\n\n",
      "2. **List with initial values**:\n",
      "   ```python\n   my_list = [1, 2, 3, 4, 5]\n",
      "   ```\n\n3. **Using list() constructor**:\n",
      "   ```python\n   my_list = list()\n",
      "   ```\n\n4. **List comprehension**:\n",
      "   ```python\n   my_list = [x for x in range(10)]\n",
      "   ```"
    ]
  },
  {
    name: "Default Reply",
    description: "General friendly response",
    prompt: "Hello",
    reasoning_content: "We are having a conversation with the user, and the user just said: \"Hello\". Based on the conversation history, we need to give a friendly response. Since the user is just greeting, we don't need to call any functions, we can reply directly.",
    reasoning_chunks: [
      "We are having a",
      " conversation with the user,",
      " and the user just said:",
      " \"Hello\".",
      " Based on the conversation history,",
      " we need to give",
      " a friendly response.",
      " Since the user is just",
      " greeting, we don't",
      " need to call any",
      " functions, we can reply",
      " directly."
    ],
    response: "Hello! How can I help you today? 😊",
    streamChunks: [
      "Hello!",
      " How can I",
      " help you today?",
      " 😊"
    ]
  }
];

// Function Call model test cases (using OpenAI tool calls format)
const functionTestCases: MockTestCase[] = [
  {
    name: "Get Current Time",
    description: "Get current time - tool call example based on real logs",
    prompt: "What time is it now?",
    response: "", // First phase returns no content, only tool call
    toolCall: {
      name: "get_time",
      arguments: {},
      id: "call_0_8a90fac8-b281-49a0-bcc9-55d7f4603891"
    },
    toolCallResponse: "Today is June 2, 2025.",
    toolCallResponseChunks: [
      "Today",
      " is",
      " June",
      " 2,",
      " 2025",
      "."
    ]
  },
  {
    name: "Weather Tool Call",
    description: "Weather query using tool calls",
    prompt: "What's the weather like in Beijing today?",
    response: "",
    toolCall: {
      name: "get_weather",
      arguments: {
        location: "Beijing",
        date: "today"
      },
      id: "call_1_weather_query_001"
    },
    toolCallResponse: "Beijing weather today: sunny, 25°C, light breeze, great for outdoor activities.",
    toolCallResponseChunks: [
      "Beijing",
      " weather",
      " today:",
      " sunny,",
      " 25°C,",
      " light",
      " breeze,",
      " great",
      " for",
      " outdoor",
      " activities."
    ]
  },
  {
    name: "Calculator Tool Call",
    description: "Mathematical calculation using tool calls",
    prompt: "Help me calculate 123 multiplied by 456",
    response: "",
    toolCall: {
      name: "calculate",
      arguments: {
        operation: "multiply",
        a: 123,
        b: 456
      },
      id: "call_2_calc_multiply_001"
    },
    toolCallResponse: "Calculation result: 123 × 456 = 56,088",
    toolCallResponseChunks: [
      "Calculation",
      " result:",
      " 123",
      " × ",
      "456",
      " = ",
      "56,088"
    ]
  },
  {
    name: "Search Tool Call",
    description: "Web search using tool calls",
    prompt: "Search for the latest AI news",
    response: "",
    toolCall: {
      name: "web_search",
      arguments: {
        query: "latest AI news",
        limit: 5
      },
      id: "call_3_search_ai_news_001"
    },
    toolCallResponse: "Found the following latest AI news:\n\n1. OpenAI releases new GPT model version\n2. Google AI achieves breakthrough in medical diagnosis\n3. Microsoft launches new AI development tools\n4. Latest advances in AI for autonomous driving\n5. New AI ethics standards published",
    toolCallResponseChunks: [
      "Found",
      " the",
      " following",
      " latest",
      " AI news:",
      "\n\n1. ",
      "OpenAI",
      " releases",
      " new",
      " GPT model",
      " version",
      "\n2. ",
      "Google",
      " AI",
      " achieves",
      " breakthrough",
      " in",
      " medical",
      " diagnosis",
      "\n3. ",
      "Microsoft",
      " launches",
      " new",
      " AI",
      " development",
      " tools",
      "\n4. ",
      "Latest",
      " advances",
      " in",
      " AI",
      " for",
      " autonomous",
      " driving",
      "\n5. ",
      "New",
      " AI",
      " ethics",
      " standards",
      " published"
    ]
  }
];

// Markdown sample model test cases
const markdownTestCases: MockTestCase[] = [
  {
    name: "Complete Document Example",
    description: "Standard Markdown document format",
    prompt: "Any question",
    response: `
# Complete Markdown Style Demonstration

This document comprehensively demonstrates all basic Markdown syntax, covering titles, paragraphs, lists, links, images, code blocks, tables, quotes and other common elements, along with usage examples of special symbols and extended features.

---

## 1. Title Hierarchy (Levels 1-6)

# Level 1 Title (H1)
## Level 2 Title (H2)
### Level 3 Title (H3)
#### Level 4 Title (H4)
##### Level 5 Title (H5)
###### Level 6 Title (H6)

---

## 2. Text Formatting

**Bold**  
*Italic*  
***Bold Italic***  
~~Strikethrough~~  
\`Inline code\`  
^Superscript^  
~Subscript~  
**_Mixed styles_**  

---

## 3. List Structures

### Unordered List
- Item 1
- Item 2
  - Sub-item A
  - Sub-item B
- Item 3

### Ordered List
1. First item
2. Second item
   1. Sub-item 1
   2. Sub-item 2
3. Third item

### Task List
- [x] Complete requirements analysis
- [ ] Write documentation
- [ ] Code review

---

## 4. Links and Images

### Links
[Google Search](https://www.google.com "Google Search")
[GitHub](https://github.com "GitHub Website")

### Images
![Sample Image](https://placehold.co/150 "Placeholder Image")
![Image with Title](https://placehold.co/300x100 "Custom Size Image")

---

## 5. Code Blocks

### Inline Code
Use \`console.log("Hello")\` for debugging.

### Code Blocks
\`\`\`python
def hello():
    print("Hello World!")
\`\`\`

\`\`\`javascript
console.log("JavaScript Example");
\`\`\`

\`\`\`json
{
  "name": "Markdown",
  "version": "1.0"
}
\`\`\`

---

## 6. Tables

| Name     | Age | City       | Notes          |
|----------|-----|------------|----------------|
| John     | 28  | New York   | Manager        |
| Jane     | 32  | Los Angeles| Engineer       |
| Bob      | 25  | Chicago    | Intern         |

**Alignment Options:**
| Left Align | Center Align | Right Align |
|:-----------|:------------:|------------:|
| 1          | 2            | 3           |

---

## 7. Quote Blocks

> This is a normal quote block  
> Supports multiple lines of text

> ## Nested Quotes
> > Second level quote block  
> > > Third level quote block

---

## 8. Dividers

---
***  
___  
- - -  
***  

---

## 9. Mathematical Formulas (LaTeX)

Inline formula: $E = mc^2$  
Standalone formula:
$$
\\int_{0}^{1} x^2 dx = \\frac{1}{3}
$$

---

## 10. Footnotes

This is a footnote example[^1].

[^1]: Footnote content can contain arbitrary text, supports multiple lines  
  as well as formatted content.

---

## 11. Custom Styles (HTML)

<div style="background: #f0f0f0; padding: 10px; border-left: 5px solid #333;">
  <strong>Tip:</strong> This is a custom HTML style block.
</div>

<mark style="background-color: #ffff00;">Highlighted text</mark>

---

## 12. Other Special Symbols

- Horizontal line: \`---\`
- Special characters: &lt; &gt; &amp; &quot; &apos;
- Escape symbols: \\*not bold\\*  
- Comments (only effective in source code): <!-- This is a comment -->

---

Through the above examples, you can comprehensively understand the basic syntax and style applications of Markdown. In actual use, you can combine different elements as needed to create documents with clear structure and beautiful formatting.`,
    streamChunks: [
      "# Complete Markdown Style Demonstration\n\n",
      "This document comprehensively demonstrates all basic Markdown syntax, covering titles, paragraphs, lists, links, images, code blocks, tables, quotes and other common elements,",
      " along with usage examples of special symbols and extended features.\n\n---\n\n## 1. Title Hierarchy (Levels 1-6)\n\n",
      "# Level 1 Title (H1)\n## Level 2 Title (H2)\n### Level 3 Title (H3)\n#### Level 4 Title (H4)\n",
      "##### Level 5 Title (H5)\n###### Level 6 Title (H6)\n\n---\n\n## 2. Text Formatting\n\n",
      "**Bold**  \n*Italic*  \n***Bold Italic***  \n~~Strikethrough~~  \n`Inline code`  \n",
      "^Superscript^  \n~Subscript~  \n**_Mixed styles_**  \n\n---\n\n## 3. List Structures\n\n",
      "### Unordered List\n- Item 1\n- Item 2\n  - Sub-item A\n  - Sub-item B\n- Item 3\n\n",
      "### Ordered List\n1. First item\n2. Second item\n   1. Sub-item 1\n   2. Sub-item 2\n3. Third item\n\n",
      "### Task List\n- [x] Complete requirements analysis\n- [ ] Write documentation\n- [ ] Code review\n\n---\n\n",
      "## 4. Links and Images\n\n### Links\n[Google Search](https://www.google.com \"Google Search\")\n",
      "[GitHub](https://github.com \"GitHub Website\")\n\n### Images\n",
      "![Sample Image](https://placehold.co/150 \"Placeholder Image\")\n",
      "![Image with Title](https://placehold.co/300x100 \"Custom Size Image\")\n\n---\n\n",
      "## 5. Code Blocks\n\n### Inline Code\nUse `console.log(\"Hello\")` for debugging.\n\n",
      "### Code Blocks\n```python\ndef hello():\n    print(\"Hello World!\")\n```\n\n",
      "```javascript\nconsole.log(\"JavaScript Example\");\n```\n\n",
      "```json\n{\n  \"name\": \"Markdown\",\n  \"version\": \"1.0\"\n}\n```\n\n---\n\n",
      "## 6. Tables\n\n| Name     | Age | City       | Notes          |\n",
      "|----------|-----|------------|----------------|\n",
      "| John     | 28  | New York   | Manager        |\n| Jane     | 32  | Los Angeles| Engineer       |\n",
      "| Bob      | 25  | Chicago    | Intern         |\n\n**Alignment Options:**\n",
      "| Left Align | Center Align | Right Align |\n|:-----------|:------------:|------------:|\n| 1          | 2            | 3           |\n\n",
      "---\n\n## 7. Quote Blocks\n\n> This is a normal quote block  \n> Supports multiple lines of text\n\n",
      "> ## Nested Quotes\n> > Second level quote block  \n> > > Third level quote block\n\n---\n\n",
      "## 8. Dividers\n\n---\n***  \n___  \n- - -  \n***  \n\n---\n\n",
      "## 9. Mathematical Formulas (LaTeX)\n\nInline formula: $E = mc^2$  \nStandalone formula:\n",
      "$$\n\\int_{0}^{1} x^2 dx = \\frac{1}{3}\n$$\n\n---\n\n",
      "## 10. Footnotes\n\nThis is a footnote example[^1].\n\n[^1]: Footnote content can contain arbitrary text, supports multiple lines  \n",
      "  as well as formatted content.\n\n---\n\n## 11. Custom Styles (HTML)\n\n",
      "<div style=\"background: #f0f0f0; padding: 10px; border-left: 5px solid #333;\">\n",
      "  <strong>Tip:</strong> This is a custom HTML style block.\n</div>\n\n",
      "<mark style=\"background-color: #ffff00;\">Highlighted text</mark>\n\n---\n\n",
      "## 12. Other Special Symbols\n\n- Horizontal line: `---`\n- Special characters: &lt; &gt; &amp; &quot; &apos;\n",
      "- Escape symbols: \\*not bold\\*  \n- Comments (only effective in source code): <!-- This is a comment -->\n\n---\n\n",
      "Through the above examples, you can comprehensively understand the basic syntax and style applications of Markdown.",
      " In actual use, you can combine different elements as needed to create documents with clear structure and beautiful formatting."
    ]
  }
];

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
    id: "mock-gpt-function",
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
