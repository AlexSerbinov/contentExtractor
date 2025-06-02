# LLM Content Extractor

A powerful Node.js tool designed to prepare large codebases for analysis by Large Language Models (LLMs) like Gemini Pro, Claude, or GPT-4. The tool intelligently combines all project files and folders into a single, well-structured Markdown document that can be easily fed into LLMs with large context windows (up to 1M+ tokens).

## 🎯 Purpose

When working with complex projects that span multiple files and directories, it becomes challenging to provide complete context to LLMs for code analysis, documentation, or refactoring tasks. This tool solves that problem by:

- **Consolidating** all project files into a single Markdown document
- **Preserving** the original directory structure for context
- **Filtering** unnecessary files to optimize token usage
- **Formatting** code with proper syntax highlighting
- **Supporting** intelligent LLM-based file filtering

## 🚀 Features

### Basic Features (contentExtractor.js)
- ✅ **Simple extraction** of all project files
- ✅ **Directory structure visualization**
- ✅ **Comment removal** option
- ✅ **Automatic exclusion** of common build artifacts
- ✅ **Markdown formatting** with syntax highlighting

### Advanced Features (llmContentExtractor.js)
- 🤖 **AI-powered file filtering** using OpenAI GPT models
- 📊 **5-level filtering aggressiveness** (from minimal to very aggressive)
- 🎯 **Custom analysis focus** for targeted extraction
- 📝 **Context-aware processing** (reads README, documentation)
- 🏷️ **Intelligent project naming** suggestions
- ⚙️ **Command-line interface** with flexible options

## 📦 Installation

1. **Clone or download** the files to your project directory

2. **Install dependencies** (for advanced version):
```bash
npm install axios yargs dotenv
```

3. **Set up environment** (for LLM filtering):
```bash
# Create .env file
echo "OPENAI_API_KEY=your_openai_api_key_here" > .env
```

## 🛠️ Usage

### Basic Version (contentExtractor.js)

The simple version requires minimal setup:

```bash
node contentExtractor.js
```

**Configuration:**
- Edit the `projectBasePath` variable in the script (default: `./files_to_extract/`)
- Set `shouldRemoveComments` to `true` if you want to strip code comments
- Modify `EXCLUDE_PATTERNS` array to customize file exclusions

### Advanced Version (llmContentExtractor.js)

The advanced version offers command-line options and AI-powered filtering:

```bash
# Basic usage (with default settings)
node llmContentExtractor.js

# Remove comments from code
node llmContentExtractor.js --deleteComments

# Apply LLM filtering (level 1-5)
node llmContentExtractor.js --filterLevel 3

# Focus on specific functionality
node llmContentExtractor.js --focus "authentication and user management logic"

# Combine all options
node llmContentExtractor.js -d -f 4 -o "API gateway and microservices architecture"
```

**Command Line Options:**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--deleteComments` | `-d` | Remove comments from code | `false` |
| `--filterLevel` | `-f` | LLM filtering level (0-5) | `2` |
| `--focus` | `-o` | Custom analysis focus prompt | `""` |

**Project Path Configuration:**
- Edit the `HARDCODED_PROJECT_PATH` variable in the script (default: `./files_to_extract/`)

## 🎚️ LLM Filtering Levels

The advanced version supports 5 levels of AI-powered file filtering:

| Level | Name | Description |
|-------|------|-------------|
| **0** | Disabled | No LLM filtering, only static exclusions |
| **1** | Minimal | Exclude build artifacts, system files, IDE configs |
| **2** | Light | + Configuration files (prettier, eslint, webpack, etc.) |
| **3** | Medium | + Documentation, large static data, basic tests |
| **4** | Aggressive | + Non-core utilities, styles, demo scripts |
| **5** | Very Aggressive | Only absolutely critical business logic files |

## 📁 Directory Structure

```
your-project/
├── contentExtractor.js          # Basic version
├── llmContentExtractor.js       # Advanced version
├── files_to_extract/           # Your project files go here
├── promts/                     # Generated output files
└── .env                        # Environment variables (for advanced)
```

## 📄 Output Format

The tool generates a comprehensive Markdown file with:

```markdown
# Project Analysis Prompt

## User-Defined Analysis Focus
> Your custom focus prompt (if provided)

## Project Directory Structure
```text
-- src/
  -- components/
    -- Header.js
    -- Footer.js
  -- utils/
    -- helpers.js
-- package.json
-- README.md
```

## File Contents

### File: src/components/Header.js
```javascript
import React from 'react';
// Your code here...
```

### File: package.json
```json
{
  "name": "your-project",
  // Your package.json content...
}
```
```

## 🔧 Configuration

### Static Exclusions

Both versions automatically exclude common files that aren't useful for analysis:

- `node_modules/`, `.git/`, `.DS_Store`
- `package-lock.json`, `yarn.lock`
- `.gitignore`, `.prettierrc`
- Build and cache directories

### Custom Exclusions

Add patterns to the `EXCLUDE_PATTERNS` array:

```javascript
const EXCLUDE_PATTERNS = [
    '.DS_Store',
    'node_modules',
    'dist',           // Add custom exclusions
    'coverage',       // Test coverage reports
    '*.log'           // Log files
];
```

## 🤖 LLM Integration Examples

### With Claude/ChatGPT
```
I have a complex Node.js project. Please analyze the codebase and:
1. Identify the main architecture patterns
2. Suggest improvements for scalability
3. Find potential security vulnerabilities

[Paste the generated Markdown here]
```

### With Gemini Pro
```
Here's my complete project codebase in Markdown format. 
Focus on: "microservices communication patterns"

[Paste the generated Markdown here]

Please provide recommendations for:
- Service discovery improvements
- API versioning strategy
- Error handling patterns
```

## 🚫 Excluded by Default

The tool automatically excludes these common patterns:

- **Dependencies**: `node_modules/`, `vendor/`
- **Version Control**: `.git/`, `.svn/`
- **Build Artifacts**: `dist/`, `build/`, `*.min.js`
- **System Files**: `.DS_Store`, `Thumbs.db`
- **Lock Files**: `package-lock.json`, `yarn.lock`, `composer.lock`
- **IDE Files**: `.vscode/`, `.idea/`, `*.swp`

## 🔍 Advanced Usage Tips

### 1. **Optimize for Large Projects**
```bash
# Use aggressive filtering for large codebases
node llmContentExtractor.js -f 4 -d -o "core business logic only"
```

### 2. **Focus on Specific Features**
```bash
# Target specific functionality
node llmContentExtractor.js -f 2 -o "user authentication and authorization system"
```

### 3. **Documentation Analysis**
```bash
# Keep documentation but remove implementation details
node llmContentExtractor.js -f 1 -o "API documentation and interface definitions"
```

## 🐛 Troubleshooting

### Common Issues

**"OpenAI API key not configured"**
- Create a `.env` file with your OpenAI API key
- Or set `filterLevel` to 0 to disable LLM filtering

**"Directory not found"**
- Check the `HARDCODED_PROJECT_PATH` in the script
- Ensure the target directory exists

**"Too many tokens"**
- Increase the `filterLevel` to be more aggressive
- Use a custom `--focus` to target specific areas
- Enable `--deleteComments` to reduce token count

**"Files not being excluded"**
- Check that file paths match exactly in the exclusion list
- Use forward slashes (`/`) in path patterns
- Test with a smaller `filterLevel` first

## 📊 Performance Tips

- **Start with level 2-3** filtering for most projects
- **Use custom focus** to target specific areas of interest
- **Remove comments** for token optimization
- **Test with small projects** before processing large codebases

## 🤝 Contributing

Feel free to customize the exclusion patterns, add new filtering logic, or extend the LLM integration for other AI models.

## 📜 License

This tool is provided as-is for educational and development purposes. Ensure you comply with OpenAI's API usage policies when using LLM filtering features.

---

**Ready to analyze your codebase with AI? Drop your project files in `files_to_extract/` and run the extractor!** 🚀