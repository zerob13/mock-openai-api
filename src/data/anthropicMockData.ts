import { MockModel } from "../types";

export const anthropicMockModels: MockModel[] = [
  {
    id: "mock-claude-markdown",
    name: "Mock Claude Markdown Sample",
    description: "Pure text model specialized in outputting standard Markdown format, does not support function calling, focuses on content display and UI debugging",
    type: "markdown",
    testCases: [
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
    
    ### Programming Languages
    
    #### Python
    \`\`\`python
    def hello():
        print("Hello World!")
        return "success"
    \`\`\`
    
    #### JavaScript
    \`\`\`javascript
    console.log("JavaScript Example");
    const greeting = () => "Hello World!";
    \`\`\`
    
    #### TypeScript
    \`\`\`typescript
    interface User {
      name: string;
      age: number;
    }
    
    const user: User = {
      name: "John",
      age: 30
    };
    \`\`\`
    
    #### C++
    \`\`\`cpp
    #include <iostream>
    using namespace std;
    
    int main() {
        cout << "Hello World!" << endl;
        return 0;
    }
    \`\`\`
    
    #### Java
    \`\`\`java
    public class HelloWorld {
        public static void main(String[] args) {
            System.out.println("Hello World!");
        }
    }
    \`\`\`
    
    #### Swift
    \`\`\`swift
    import Foundation
    
    func greet(name: String) -> String {
        return "Hello, \\(name)!"
    }
    
    print(greet(name: "World"))
    \`\`\`
    
    #### Shell/Bash
    \`\`\`bash
    #!/bin/bash
    echo "Hello World!"
    for i in {1..5}; do
        echo "Count: $i"
    done
    \`\`\`
    
    ### Frontend Frameworks
    
    #### React (JSX)
    \`\`\`jsx
    import React from 'react';
    
    const HelloComponent = ({ name }) => {
      return (
        <div className="greeting">
          <h1>Hello, {name}!</h1>
          <button onClick={() => alert('Clicked!')}>
            Click me
          </button>
        </div>
      );
    };
    
    export default HelloComponent;
    \`\`\`
    
    #### Vue
    \`\`\`vue
    <template>
      <div class="hello">
        <h1>{{ message }}</h1>
        <button @click="updateMessage">Update</button>
      </div>
    </template>
    
    <script>
    export default {
      data() {
        return {
          message: 'Hello Vue!'
        }
      },
      methods: {
        updateMessage() {
          this.message = 'Updated!';
        }
      }
    }
    </script>
    
    <style scoped>
    .hello {
      color: #42b983;
    }
    </style>
    \`\`\`
    
    ### Data & Configuration
    
    #### JSON
    \`\`\`json
    {
      "name": "Markdown",
      "version": "1.0",
      "dependencies": {
        "react": "^18.0.0",
        "typescript": "^4.9.0"
      }
    }
    \`\`\`
    
    #### YAML
    \`\`\`yaml
    name: CI/CD Pipeline
    on:
      push:
        branches: [ main ]
    jobs:
      build:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v3
          - name: Setup Node
            uses: actions/setup-node@v3
    \`\`\`
    
    #### XML
    \`\`\`xml
    <?xml version="1.0" encoding="UTF-8"?>
    <configuration>
      <database>
        <host>localhost</host>
        <port>5432</port>
      </database>
    </configuration>
    \`\`\`
    
    ### Database & Query Languages
    
    #### SQL
    \`\`\`sql
    SELECT u.name, u.email, COUNT(o.id) as order_count
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.created_at >= '2023-01-01'
    GROUP BY u.id, u.name, u.email
    ORDER BY order_count DESC;
    \`\`\`
    
    #### GraphQL
    \`\`\`graphql
    query GetUser($id: ID!) {
      user(id: $id) {
        name
        email
        posts {
          title
          content
          createdAt
        }
      }
    }
    \`\`\`
    
    ### Markup & Styling
    
    #### HTML
    \`\`\`html
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Sample Page</title>
    </head>
    <body>
        <h1>Welcome</h1>
        <p>This is a sample HTML page.</p>
    </body>
    </html>
    \`\`\`
    
    #### CSS
    \`\`\`css
    .container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    
    .card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      padding: 2rem;
    }
    \`\`\`
    
    #### SCSS/Sass
    \`\`\`scss
    $primary-color: #3498db;
    $border-radius: 4px;
    
    .button {
      background-color: $primary-color;
      border-radius: $border-radius;
      padding: 0.5rem 1rem;
      
      &:hover {
        background-color: darken($primary-color, 10%);
      }
      
      &.large {
        padding: 1rem 2rem;
        font-size: 1.2rem;
      }
    }
    \`\`\`
    
    ### Diagrams & Graphics
    
    #### Mermaid
    \`\`\`mermaid
    graph TD
        A[Start] --> B{Is it working?}
        B -->|Yes| C[Great!]
        B -->|No| D[Debug]
        D --> E[Fix Issue]
        E --> B
        C --> F[End]
    \`\`\`
    
    #### SVG
    \`\`\`svg
    <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="100" r="80" fill="#3498db" stroke="#2c3e50" stroke-width="4"/>
      <text x="100" y="105" text-anchor="middle" fill="white" font-size="16">SVG Circle</text>
    </svg>
    \`\`\`
    
    ### Other Languages
    
    #### Go
    \`\`\`go
    package main
    
    import "fmt"
    
    func main() {
        fmt.Println("Hello, World!")
        
        numbers := []int{1, 2, 3, 4, 5}
        for _, num := range numbers {
            fmt.Printf("Number: %d\\n", num)
        }
    }
    \`\`\`
    
    #### Rust
    \`\`\`rust
    fn main() {
        let greeting = "Hello, World!";
        println!("{}", greeting);
        
        let numbers: Vec<i32> = (1..=5).collect();
        for num in &numbers {
            println!("Number: {}", num);
        }
    }
    \`\`\`
    
    #### PHP
    \`\`\`php
    <?php
    class Greeting {
        private $message;
        
        public function __construct($message) {
            $this->message = $message;
        }
        
        public function say() {
            echo $this->message . "\\n";
        }
    }
    
    $greeting = new Greeting("Hello World!");
    $greeting->say();
    ?>
    \`\`\`
    
    #### Ruby
    \`\`\`ruby
    class Greeting
      def initialize(message)
        @message = message
      end
      
      def say
        puts @message
      end
    end
    
    greeting = Greeting.new("Hello World!")
    greeting.say
    \`\`\`
    
    #### Dockerfile
    \`\`\`dockerfile
    FROM node:18-alpine
    
    WORKDIR /app
    
    COPY package*.json ./
    RUN npm ci --only=production
    
    COPY . .
    
    EXPOSE 3000
    
    CMD ["npm", "start"]
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
          "### Programming Languages\n\n#### Python\n```python\ndef hello():\n    print(\"Hello World!\")\n    return \"success\"\n```\n\n",
          "#### JavaScript\n```javascript\nconsole.log(\"JavaScript Example\");\nconst greeting = () => \"Hello World!\";\n```\n\n",
          "#### TypeScript\n```typescript\ninterface User {\n  name: string;\n  age: number;\n}\n\nconst user: User = {\n  name: \"John\",\n  age: 30\n};\n```\n\n",
          "#### C++\n```cpp\n#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << \"Hello World!\" << endl;\n    return 0;\n}\n```\n\n",
          "#### Java\n```java\npublic class HelloWorld {\n    public static void main(String[] args) {\n        System.out.println(\"Hello World!\");\n    }\n}\n```\n\n",
          "#### Swift\n```swift\nimport Foundation\n\nfunc greet(name: String) -> String {\n    return \"Hello, \\(name)!\"\n}\n\nprint(greet(name: \"World\"))\n```\n\n",
          "#### Shell/Bash\n```bash\n#!/bin/bash\necho \"Hello World!\"\nfor i in {1..5}; do\n    echo \"Count: $i\"\ndone\n```\n\n",
          "### Frontend Frameworks\n\n#### React (JSX)\n```jsx\nimport React from 'react';\n\nconst HelloComponent = ({ name }) => {\n  return (\n    <div className=\"greeting\">\n      <h1>Hello, {name}!</h1>\n      <button onClick={() => alert('Clicked!')}>\n        Click me\n      </button>\n    </div>\n  );\n};\n\nexport default HelloComponent;\n```\n\n",
          "#### Vue\n```vue\n<template>\n  <div class=\"hello\">\n    <h1>{{ message }}</h1>\n    <button @click=\"updateMessage\">Update</button>\n  </div>\n</template>\n\n<script>\nexport default {\n  data() {\n    return {\n      message: 'Hello Vue!'\n    }\n  },\n  methods: {\n    updateMessage() {\n      this.message = 'Updated!';\n    }\n  }\n}\n</script>\n\n<style scoped>\n.hello {\n  color: #42b983;\n}\n</style>\n```\n\n",
          "### Data & Configuration\n\n#### JSON\n```json\n{\n  \"name\": \"Markdown\",\n  \"version\": \"1.0\",\n  \"dependencies\": {\n    \"react\": \"^18.0.0\",\n    \"typescript\": \"^4.9.0\"\n  }\n}\n```\n\n",
          "#### YAML\n```yaml\nname: CI/CD Pipeline\non:\n  push:\n    branches: [ main ]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v3\n      - name: Setup Node\n        uses: actions/setup-node@v3\n```\n\n",
          "#### XML\n```xml\n<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<configuration>\n  <database>\n    <host>localhost</host>\n    <port>5432</port>\n  </database>\n</configuration>\n```\n\n",
          "### Database & Query Languages\n\n#### SQL\n```sql\nSELECT u.name, u.email, COUNT(o.id) as order_count\nFROM users u\nLEFT JOIN orders o ON u.id = o.user_id\nWHERE u.created_at >= '2023-01-01'\nGROUP BY u.id, u.name, u.email\nORDER BY order_count DESC;\n```\n\n",
          "#### GraphQL\n```graphql\nquery GetUser($id: ID!) {\n  user(id: $id) {\n    name\n    email\n    posts {\n      title\n      content\n      createdAt\n    }\n  }\n}\n```\n\n",
          "### Markup & Styling\n\n#### HTML\n```html\n<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n    <meta charset=\"UTF-8\">\n    <title>Sample Page</title>\n</head>\n<body>\n    <h1>Welcome</h1>\n    <p>This is a sample HTML page.</p>\n</body>\n</html>\n```\n\n",
          "#### CSS\n```css\n.container {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  min-height: 100vh;\n  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n}\n\n.card {\n  background: white;\n  border-radius: 8px;\n  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);\n  padding: 2rem;\n}\n```\n\n",
          "#### SCSS/Sass\n```scss\n$primary-color: #3498db;\n$border-radius: 4px;\n\n.button {\n  background-color: $primary-color;\n  border-radius: $border-radius;\n  padding: 0.5rem 1rem;\n  \n  &:hover {\n    background-color: darken($primary-color, 10%);\n  }\n  \n  &.large {\n    padding: 1rem 2rem;\n    font-size: 1.2rem;\n  }\n}\n```\n\n",
          "### Diagrams & Graphics\n\n#### Mermaid\n```mermaid\ngraph TD\n    A[Start] --> B{Is it working?}\n    B -->|Yes| C[Great!]\n    B -->|No| D[Debug]\n    D --> E[Fix Issue]\n    E --> B\n    C --> F[End]\n```\n\n",
          "#### SVG\n```svg\n<svg width=\"200\" height=\"200\" xmlns=\"http://www.w3.org/2000/svg\">\n  <circle cx=\"100\" cy=\"100\" r=\"80\" fill=\"#3498db\" stroke=\"#2c3e50\" stroke-width=\"4\"/>\n  <text x=\"100\" y=\"105\" text-anchor=\"middle\" fill=\"white\" font-size=\"16\">SVG Circle</text>\n</svg>\n```\n\n",
          "### Other Languages\n\n#### Go\n```go\npackage main\n\nimport \"fmt\"\n\nfunc main() {\n    fmt.Println(\"Hello, World!\")\n    \n    numbers := []int{1, 2, 3, 4, 5}\n    for _, num := range numbers {\n        fmt.Printf(\"Number: %d\\n\", num)\n    }\n}\n```\n\n",
          "#### Rust\n```rust\nfn main() {\n    let greeting = \"Hello, World!\";\n    println!(\"{}\", greeting);\n    \n    let numbers: Vec<i32> = (1..=5).collect();\n    for num in &numbers {\n        println!(\"Number: {}\", num);\n    }\n}\n```\n\n",
          "#### PHP\n```php\n<?php\nclass Greeting {\n    private $message;\n    \n    public function __construct($message) {\n        $this->message = $message;\n    }\n    \n    public function say() {\n        echo $this->message . \"\\n\";\n    }\n}\n\n$greeting = new Greeting(\"Hello World!\");\n$greeting->say();\n?>\n```\n\n",
          "#### Ruby\n```ruby\nclass Greeting\n  def initialize(message)\n    @message = message\n  end\n  \n  def say\n    puts @message\n  end\nend\n\ngreeting = Greeting.new(\"Hello World!\")\ngreeting.say\n```\n\n",
          "#### Dockerfile\n```dockerfile\nFROM node:18-alpine\n\nWORKDIR /app\n\nCOPY package*.json ./\nRUN npm ci --only=production\n\nCOPY . .\n\nEXPOSE 3000\n\nCMD [\"npm\", \"start\"]\n```\n\n---\n\n",
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
      },
    ]
  }
]
