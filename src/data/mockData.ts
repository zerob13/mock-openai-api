import { MockModel, MockTestCase } from '../types';

// 思考型模型的测试用例
const thinkingTestCases: MockTestCase[] = [
  {
    name: "数学问题",
    description: "解决复杂数学问题",
    prompt: "计算 2+2",
    response: `<thinking>
这是一个简单的加法问题。我需要计算 2 + 2。
2 + 2 = 4
这是基础的算术运算。
</thinking>

2 + 2 = 4

这是一个基础的加法运算。`,
    streamChunks: [
      "<thinking>\n这是一个简单的加法问题。我需要计算",
      " 2 + 2。\n2 + 2 = 4\n这是基础的算术运算。\n</thinking>\n\n",
      "2 + 2 = 4\n\n这是一个基础的加法运算。"
    ]
  },
  {
    name: "编程问题",
    description: "代码问题解答",
    prompt: "如何用 Python 创建一个列表？",
    response: `<thinking>
用户询问如何用 Python 创建列表。这是一个基础的 Python 问题。
Python 中创建列表有几种方式：
1. 使用方括号 []
2. 使用 list() 构造函数
3. 使用列表推导式
我应该提供清晰的例子。
</thinking>

在 Python 中创建列表有几种方式：

1. **空列表**：
   \`\`\`python
   my_list = []
   \`\`\`

2. **带初始值的列表**：
   \`\`\`python
   my_list = [1, 2, 3, 4, 5]
   \`\`\`

3. **使用 list() 构造函数**：
   \`\`\`python
   my_list = list()
   \`\`\`

4. **列表推导式**：
   \`\`\`python
   my_list = [x for x in range(10)]
   \`\`\``,
    streamChunks: [
      "<thinking>\n用户询问如何用 Python 创建列表。这是一个基础的 Python 问题。\n",
      "Python 中创建列表有几种方式：\n1. 使用方括号 []\n2. 使用 list() 构造函数\n",
      "3. 使用列表推导式\n我应该提供清晰的例子。\n</thinking>\n\n",
      "在 Python 中创建列表有几种方式：\n\n1. **空列表**：\n   ```python\n   my_list = []\n   ```\n\n",
      "2. **带初始值的列表**：\n   ```python\n   my_list = [1, 2, 3, 4, 5]\n   ```\n\n",
      "3. **使用 list() 构造函数**：\n   ```python\n   my_list = list()\n   ```\n\n",
      "4. **列表推导式**：\n   ```python\n   my_list = [x for x in range(10)]\n   ```"
    ]
  }
];

// Function Call 模型的测试用例
const functionTestCases: MockTestCase[] = [
  {
    name: "天气查询",
    description: "查询天气信息",
    prompt: "今天北京的天气怎么样？",
    response: "我来为您查询北京今天的天气情况。",
    functionCall: {
      name: "get_weather",
      arguments: {
        location: "北京",
        date: "today"
      }
    }
  },
  {
    name: "计算器",
    description: "执行数学计算",
    prompt: "帮我计算 15 * 23",
    response: "我来为您计算 15 乘以 23 的结果。",
    functionCall: {
      name: "calculate",
      arguments: {
        operation: "multiply",
        a: 15,
        b: 23
      }
    }
  },
  {
    name: "时间查询",
    description: "查询当前时间",
    prompt: "现在几点了？",
    response: "让我为您查询当前时间。",
    functionCall: {
      name: "get_current_time",
      arguments: {
        timezone: "Asia/Shanghai"
      }
    }
  }
];

// Markdown 示例模型的测试用例
const markdownTestCases: MockTestCase[] = [
  {
    name: "完整文档示例",
    description: "标准的 Markdown 文档格式",
    prompt: "任何问题",
    response: `你是一个复读机，把我给你的内容打印出来，内容是


# Markdown 样式全功能演示

本文档全面展示 Markdown 的所有基础语法，涵盖标题、段落、列表、链接、图片、代码块、表格、引用等常见元素，并包含特殊符号和扩展功能的使用示例。

---

## 1. 标题层级（1-6级）

# 一级标题（H1）
## 二级标题（H2）
### 三级标题（H3）
#### 四级标题（H4）
##### 五级标题（H5）
###### 六级标题（H6）

---

## 2. 文本格式化

**加粗**  
*斜体*  
***加粗斜体***  
~~删除线~~  
\`内联代码\`  
^上标^  
~下标~  
**_混合样式_**  

---

## 3. 列表结构

### 无序列表
- 项目1
- 项目2
  - 子项目A
  - 子项目B
- 项目3

### 有序列表
1. 第一项
2. 第二项
   1. 子项1
   2. 子项2
3. 第三项

### 任务列表
- [x] 完成需求分析
- [ ] 编写文档
- [ ] 代码审查

---

## 4. 链接与图片

### 链接
[百度搜索](https://www.baidu.com "百度搜索")
[GitHub](https://github.com "GitHub官网")

### 图片
![示例图片](https://via.placeholder.com/150 "占位图片")
![带标题的图片](https://via.placeholder.com/300x100 "自定义尺寸图片")

---

## 5. 代码块

### 内联代码
使用 \`console.log("Hello")\` 进行调试。

### 代码块
\`\`\`python
def hello():
    print("Hello World!")
\`\`\`

\`\`\`javascript
console.log("JavaScript 示例");
\`\`\`

\`\`\`json
{
  "name": "Markdown",
  "version": "1.0"
}
\`\`\`

---

## 6. 表格

| 姓名     | 年龄 | 城市       | 备注           |
|----------|------|------------|----------------|
| 张三     | 28   | 北京       | 主任           |
| 李四     | 32   | 上海       | 工程师         |
| 王五     | 25   | 广州       | 实习生         |

**对齐方式：**
| 左对齐 | 居中对齐 | 右对齐 |
|:------|:------:|------:|
| 1     | 2      | 3     |

---

## 7. 引用块

> 这是一个普通引用块  
> 支持多行文本

> ## 嵌套引用
> > 二级引用块  
> > > 三级引用块

---

## 8. 分隔线

---
***  
___  
- - -  
***  

---

## 9. 数学公式（LaTeX）

行内公式：$E = mc^2$  
独立公式：
$$
\\int_{0}^{1} x^2 dx = \\frac{1}{3}
$$

---

## 10. 脚注

这是一个脚注示例[^1].

[^1]: 脚注内容可以包含任意文本，支持多行  
  以及格式化内容。

---

## 11. 自定义样式（HTML）

<div style="background: #f0f0f0; padding: 10px; border-left: 5px solid #333;">
  <strong>提示：</strong> 这是一个自定义 HTML 样式块。
</div>

<mark style="background-color: #ffff00;">高亮文本</mark>

---

## 12. 其他特殊符号

- 水平线：\`---\`
- 特殊字符：&lt; &gt; &amp; &quot; &apos;
- 逃逸符号：\\*不加粗\\*  
- 注释（仅源码中有效）：<!-- 这是注释 -->

---

通过以上示例，您可以全面了解 Markdown 的基本语法和样式应用。实际使用中可根据需要组合不同元素，创建结构清晰、格式美观的文档内容。`,
    streamChunks: [
      "你是一个复读机，把我给你的内容打印出来，内容是\n\n\n# Markdown 样式全功能演示\n\n",
      "本文档全面展示 Markdown 的所有基础语法，涵盖标题、段落、列表、链接、图片、代码块、表格、引用等常见元素，",
      "并包含特殊符号和扩展功能的使用示例。\n\n---\n\n## 1. 标题层级（1-6级）\n\n",
      "# 一级标题（H1）\n## 二级标题（H2）\n### 三级标题（H3）\n#### 四级标题（H4）\n",
      "##### 五级标题（H5）\n###### 六级标题（H6）\n\n---\n\n## 2. 文本格式化\n\n",
      "**加粗**  \n*斜体*  \n***加粗斜体***  \n~~删除线~~  \n`内联代码`  \n",
      "^上标^  \n~下标~  \n**_混合样式_**  \n\n---\n\n## 3. 列表结构\n\n",
      "### 无序列表\n- 项目1\n- 项目2\n  - 子项目A\n  - 子项目B\n- 项目3\n\n",
      "### 有序列表\n1. 第一项\n2. 第二项\n   1. 子项1\n   2. 子项2\n3. 第三项\n\n",
      "### 任务列表\n- [x] 完成需求分析\n- [ ] 编写文档\n- [ ] 代码审查\n\n---\n\n",
      "## 4. 链接与图片\n\n### 链接\n[百度搜索](https://www.baidu.com \"百度搜索\")\n",
      "[GitHub](https://github.com \"GitHub官网\")\n\n### 图片\n",
      "![示例图片](https://via.placeholder.com/150 \"占位图片\")\n",
      "![带标题的图片](https://via.placeholder.com/300x100 \"自定义尺寸图片\")\n\n---\n\n",
      "## 5. 代码块\n\n### 内联代码\n使用 `console.log(\"Hello\")` 进行调试。\n\n",
      "### 代码块\n```python\ndef hello():\n    print(\"Hello World!\")\n```\n\n",
      "```javascript\nconsole.log(\"JavaScript 示例\");\n```\n\n",
      "```json\n{\n  \"name\": \"Markdown\",\n  \"version\": \"1.0\"\n}\n```\n\n---\n\n",
      "## 6. 表格\n\n| 姓名     | 年龄 | 城市       | 备注           |\n",
      "|----------|------|------------|----------------|\n",
      "| 张三     | 28   | 北京       | 主任           |\n| 李四     | 32   | 上海       | 工程师         |\n",
      "| 王五     | 25   | 广州       | 实习生         |\n\n**对齐方式：**\n",
      "| 左对齐 | 居中对齐 | 右对齐 |\n|:------|:------:|------:|\n| 1     | 2      | 3     |\n\n",
      "---\n\n## 7. 引用块\n\n> 这是一个普通引用块  \n> 支持多行文本\n\n",
      "> ## 嵌套引用\n> > 二级引用块  \n> > > 三级引用块\n\n---\n\n",
      "## 8. 分隔线\n\n---\n***  \n___  \n- - -  \n***  \n\n---\n\n",
      "## 9. 数学公式（LaTeX）\n\n行内公式：$E = mc^2$  \n独立公式：\n",
      "$$\n\\int_{0}^{1} x^2 dx = \\frac{1}{3}\n$$\n\n---\n\n",
      "## 10. 脚注\n\n这是一个脚注示例[^1].\n\n[^1]: 脚注内容可以包含任意文本，支持多行  \n",
      "  以及格式化内容。\n\n---\n\n## 11. 自定义样式（HTML）\n\n",
      "<div style=\"background: #f0f0f0; padding: 10px; border-left: 5px solid #333;\">\n",
      "  <strong>提示：</strong> 这是一个自定义 HTML 样式块。\n</div>\n\n",
      "<mark style=\"background-color: #ffff00;\">高亮文本</mark>\n\n---\n\n",
      "## 12. 其他特殊符号\n\n- 水平线：`---`\n- 特殊字符：&lt; &gt; &amp; &quot; &apos;\n",
      "- 逃逸符号：\\*不加粗\\*  \n- 注释（仅源码中有效）：<!-- 这是注释 -->\n\n---\n\n",
      "通过以上示例，您可以全面了解 Markdown 的基本语法和样式应用。",
      "实际使用中可根据需要组合不同元素，创建结构清晰、格式美观的文档内容。"
    ]
  }
];

// 预定义的模型列表
export const mockModels: MockModel[] = [
  {
    id: "mock-gpt-thinking",
    name: "Mock GPT 思考模式",
    description: "支持显示思考过程的模型，适合调试推理逻辑",
    type: "thinking",
    testCases: thinkingTestCases
  },
  {
    id: "mock-gpt-function",
    name: "Mock GPT 函数调用",
    description: "支持函数调用的模型，适合测试工具集成",
    type: "function",
    testCases: functionTestCases
  },
  {
    id: "mock-gpt-markdown",
    name: "Mock GPT Markdown 示例",
    description: "始终输出标准 Markdown 格式，适合 UI 调试",
    type: "markdown",
    testCases: markdownTestCases
  },
  {
    id: "gpt-4o-image",
    name: "GPT-4O 图像生成",
    description: "专门用于图像生成的模型，支持多种尺寸和风格",
    type: "image",
    testCases: [{
      name: "图像生成示例",
      description: "生成高质量图像",
      prompt: "任何图像描述",
      response: "我已经为您生成了图像。"
    }]
  }
];

// 图像生成的模拟数据
export const mockImageUrls = [
  "https://via.placeholder.com/1024x1024/FF6B6B/FFFFFF?text=Mock+Image+1",
  "https://via.placeholder.com/1024x1024/4ECDC4/FFFFFF?text=Mock+Image+2",
  "https://via.placeholder.com/1024x1024/45B7D1/FFFFFF?text=Mock+Image+3",
  "https://via.placeholder.com/1024x1024/96CEB4/FFFFFF?text=Mock+Image+4",
  "https://via.placeholder.com/1024x1024/FFEAA7/000000?text=Mock+Image+5"
]; 
