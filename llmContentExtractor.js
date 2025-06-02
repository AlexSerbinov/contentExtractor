// External dependencies
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
require('dotenv').config(); // Load environment variables from .env file

// --- Configuration & Constants ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    console.warn("WARNING: OPENAI_API_KEY is not set in the environment variables. LLM-based features will be disabled or may fail.");
}

const LLM_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions'; // More generic name

// Static list of exclusions (files/folders to always ignore)
const STATIC_EXCLUDE_PATTERNS = [
    '.DS_Store',
    'node_modules',
    '.git',
    '.gitignore',
    '.prettierrc',
    'package-lock.json',
    'yarn.lock',
    'prompts', // Assuming this is the output folder for generated prompts
    'promts' // Or if you rename the output folder
];

const LLM_FILTER_LEVEL_DESCRIPTIONS = {
    1: "Minimal: Exclude only obviously unnecessary files for analysis: lock files (package-lock.json, yarn.lock), system files (.DS_Store), version control system files (contents of .git folder), IDE configurations (.vscode, .idea). Do not exclude code files or important project configurations.",
    2: "Light: Previous level + build/formatting configuration files that are not core logic (e.g., typical .prettierrc, .eslintrc.js, babel.config.js, webpack.config.js, tsconfig.json), unless they are exceptionally complex or unique for understanding the project.",
    3: "Medium: Previous level + documentation files (except for the main README.md if it exists and is small), files with large static data (e.g., large JSONs with mock data if not critical for demonstrating logic), secondary test files (e.g., individual unit tests for simple utilities, but keep integration or key E2E tests).",
    4: "Aggressive: Previous level + less important modules, utilities that are not central to the main functionality, possibly style files (CSS, SCSS) or less significant UI components (if the focus is on backend logic or core business logic). Also consider excluding files with usage examples or demo scripts that are not part of the main product.",
    5: "Very Aggressive: Previous level + any files that are not absolutely critical for understanding the core business logic and architecture of the project. Leave only the core. Be very selective, but consider that losing some files might complicate understanding relationships."
};

// Hardcoded path for the project to analyze
const HARDCODED_PROJECT_PATH = './files_to_extract/'; // <--- SPECIFY YOUR TARGET PATH HERE

// --- Helper Functions ---

/**
 * Generates a string representation of the folder structure.
 * @param {string} dir - The current directory to scan.
 * @param {string} basePath - The root path of the project, for relative path calculations.
 * @param {string} prefix - The prefix for visual indentation of the structure.
 * @returns {Promise<string>} A string representing the folder structure.
 */
async function generateFolderStructureString(dir, basePath, prefix = '') {
    let structure = '';
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            // Skip if entry name itself is in static exclude list (e.g. .git)
            if (STATIC_EXCLUDE_PATTERNS.some(exclude => entry.name === exclude)) {
                continue;
            }
            // Skip if relative path starts with an exclude pattern (e.g. node_modules/)
            const entryPath = path.join(dir, entry.name);
            const relativePath = path.relative(basePath, entryPath);
            if (STATIC_EXCLUDE_PATTERNS.some(exclude => relativePath.startsWith(exclude + path.sep))) {
                continue;
            }

            structure += `${prefix}-- ${entry.name}${entry.isDirectory() ? '/' : ''}\n`;
            if (entry.isDirectory()) {
                structure += await generateFolderStructureString(entryPath, basePath, prefix + '  ');
            }
        }
    } catch (error) {
        console.warn(`Could not read directory ${dir}: ${error.message}`);
        return `${prefix}Error reading directory: ${dir}\n`;
    }
    return structure;
}

/**
 * Reads additional context files for the LLM (README.md, memory-bank/*, other .md files).
 * @param {string} basePath - The root path of the project.
 * @returns {Promise<object>} An object containing content from README, memory-bank, and other MD files.
 */
async function readAdditionalContext(basePath) {
    const context = {
        readmeContent: null,
        memoryBankFiles: [],
        mdFiles: []
    };

    const readFileIfExists = async (filePath, relativePathName = null) => {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return {
                name: path.basename(filePath),
                path: relativePathName || path.relative(basePath, filePath),
                content: content.trim()
            };
        } catch (error) {
            // File not found is normal, other errors might be logged if needed
            if (error.code !== 'ENOENT') {
                console.warn(`Could not read context file ${filePath}: ${error.message}`);
            }
            return null;
        }
    };

    // Read README.md
    const readmeData = await readFileIfExists(path.join(basePath, 'README.md'), 'README.md');
    if (readmeData) context.readmeContent = readmeData.content;

    // Read files from memory-bank/
    const memoryBankPath = path.join(basePath, 'memory-bank');
    try {
        const memoryBankEntries = await fs.readdir(memoryBankPath, { withFileTypes: true });
        for (const entry of memoryBankEntries) {
            if (entry.isFile() && !STATIC_EXCLUDE_PATTERNS.some(ex => entry.name.includes(ex))) {
                const fileData = await readFileIfExists(path.join(memoryBankPath, entry.name));
                if (fileData) context.memoryBankFiles.push(fileData);
            }
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`Could not read memory-bank directory ${memoryBankPath}: ${error.message}`);
        }
    }

    // Read all .md files from the project root (non-recursively, avoid duplicates)
    try {
        const rootEntries = await fs.readdir(basePath, { withFileTypes: true });
        for (const entry of rootEntries) {
            if (
                entry.isFile() &&
                entry.name.toLowerCase().endsWith('.md') &&
                entry.name.toLowerCase() !== 'readme.md' && // README.md already handled
                !STATIC_EXCLUDE_PATTERNS.some(ex => entry.name.includes(ex))
            ) {
                const fileData = await readFileIfExists(path.join(basePath, entry.name), entry.name);
                if (fileData) context.mdFiles.push(fileData);
            }
        }
    } catch (error) {
        console.warn(`Error reading root directory for .md files ${basePath}: ${error.message}`);
    }

    return context;
}

/**
 * Gets a list of files suggested for exclusion by an LLM and a suggested project name.
 * @param {string} projectStructureString - String representation of the project structure.
 * @param {number} filterLevel - The aggressiveness level for LLM filtering (0-5).
 * @param {string} basePath - The root path of the project.
 * @param {string} [customFocusPrompt=""] - A custom prompt to guide LLM's focus.
 * @returns {Promise<{excludedFiles: string[], suggestedFileName: string | null}>}
 */
async function getLLMFilteredExclusions(projectStructureString, filterLevel, basePath, customFocusPrompt = "") {
    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'YOUR_OPENAI_API_KEY_PLACEHOLDER' || OPENAI_API_KEY.length < 10) { // Added a placeholder check
        console.warn("WARNING: OpenAI API key is not configured or is a placeholder. LLM filtering will be skipped.");
        return { excludedFiles: [], suggestedFileName: null };
    }
    if (filterLevel === 0) {
        console.log("LLM filtering is disabled (level 0).");
        return { excludedFiles: [], suggestedFileName: null };
    }

    console.log("Reading additional context for LLM (README.md, memory-bank/*, .md files)...");
    const additionalContext = await readAdditionalContext(basePath);

    let focusInstruction = "";
    if (customFocusPrompt && customFocusPrompt.trim() !== "") {
        focusInstruction = `\n\nIMPORTANT: The subsequent code analysis will focus on: "${customFocusPrompt}". Please consider this focus when selecting files for exclusion. Files directly related to this focus, or necessary for understanding it (e.g., dependencies, related configurations), should be RETAINED, even if you would normally exclude them at this aggressiveness level.`;
    }

    let contextSection = "\n\n## ADDITIONAL PROJECT CONTEXT\n\n";
    if (additionalContext.readmeContent) {
        contextSection += `### README.md\n\`\`\`markdown\n${additionalContext.readmeContent}\n\`\`\`\n\n`;
    }
    if (additionalContext.memoryBankFiles.length > 0) {
        contextSection += `### Files from Memory Bank\n`;
        additionalContext.memoryBankFiles.forEach(file => {
            contextSection += `\n#### ${file.path}\n\`\`\`markdown\n${file.content}\n\`\`\`\n`;
        });
        contextSection += `\n`;
    }
    if (additionalContext.mdFiles.length > 0) {
        contextSection += `### Other .md Files\n`;
        additionalContext.mdFiles.forEach(file => {
            contextSection += `\n#### ${file.path}\n\`\`\`markdown\n${file.content}\n\`\`\`\n`;
        });
        contextSection += `\n`;
    }
    if (contextSection === "\n\n## ADDITIONAL PROJECT CONTEXT\n\n") { // No additional context found
        contextSection = "\n\n(Additional context: README.md, memory-bank files, and other .md files were not found or are empty)\n\n";
    }

    const promptContent = `
You are a code analysis assistant. I need to prepare project files for analysis by another LLM.
To reduce the number of tokens, I want to filter out some files.

Here is the project structure (paths relative to the project root "${path.basename(basePath)}"):
\`\`\`text
${projectStructureString}
\`\`\`${contextSection}

Filtering level: ${filterLevel} (${LLM_FILTER_LEVEL_DESCRIPTIONS[filterLevel] || 'Apply general principles for this aggressiveness level'}).${focusInstruction}

Your task:
1. Analyze the provided file structure and determine the main purpose of the project, using additional context from README.md, memory-bank, and .md files.
2. Consider the specified filtering level.
3. If an "IMPORTANT" analysis focus is provided, pay special attention to it. Concentrate on what is requested in the focus.
4. The static exclusion list (${STATIC_EXCLUDE_PATTERNS.join(', ')}) will already be applied separately; do not duplicate them unless they are part of the provided structure that somehow bypassed static filtering.
5. Based on the project structure, additional context, and its purpose, devise a short, descriptive project name (2-4 words, English, no spaces, camelCase or kebab-case).

Return a JSON object with the following structure:
{
  "excludedFiles": ["path1/to/file.js", "path2/to/anotherFile.ts"],
  "suggestedFileName": "project-name-idea"
}

- excludedFiles: An array of strings with RELATIVE PATHS to files (relative to "${path.basename(basePath)}") that you recommend excluding. Paths must be exactly as in the structure.
- suggestedFileName: A short, descriptive project name based on the analysis of the structure and context (e.g., "apiGateway", "userAuthService", "ecommerceBackend", "blogApplication").

If, considering the level and focus, you do not think any files from the provided structure should be excluded, return an empty array for excludedFiles.
Ensure your response is a valid JSON object.
`;

    try {
        console.log(`Sending request to LLM for file filtering and name generation (Level: ${filterLevel}, Focus: "${customFocusPrompt || 'none'}")...`);
        // console.log("LLM Prompt Content:", promptContent); // Uncomment for debugging the prompt
        const response = await axios.post(LLM_API_ENDPOINT, {
            model: "gpt-4o", // Or "gpt-4-turbo", "gpt-4o-mini"
            messages: [{ role: "user", content: promptContent }],
            response_format: { type: "json_object" },
            temperature: 0.2, // Low temperature for more deterministic results
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log("LLM raw response data:", JSON.stringify(response.data, null, 2)); // More readable raw log
        const responseContent = response.data.choices[0].message.content;
        
        let result = { excludedFiles: [], suggestedFileName: null };
        try {
            const parsedJson = JSON.parse(responseContent);
            if (parsedJson.excludedFiles && Array.isArray(parsedJson.excludedFiles)) {
                result.excludedFiles = parsedJson.excludedFiles
                    .filter(item => typeof item === 'string')
                    .map(p => path.normalize(p.trim())); // Normalize paths for consistent comparison
            }
            if (parsedJson.suggestedFileName && typeof parsedJson.suggestedFileName === 'string') {
                result.suggestedFileName = parsedJson.suggestedFileName.trim().replace(/\s+/g, '-'); // Basic sanitization
            }
        } catch (e) {
            console.error("Error parsing JSON response from LLM (filtering):", e);
            console.error("Problematic JSON string:", responseContent);
            // Fallback to no exclusions if parsing fails
        }
        
        console.log("Files suggested by LLM for exclusion:", result.excludedFiles);
        console.log("Project name suggested by LLM:", result.suggestedFileName);
        return result;

    } catch (error) {
        if (error.response) {
            console.error('Error from OpenAI API (filtering):', error.response.status, JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error sending request to OpenAI API (filtering):', error.message);
        }
        return { excludedFiles: [], suggestedFileName: null }; // Fallback
    }
}

/**
 * Reads files recursively, applying static and LLM exclusions.
 * @param {string} dir - Current directory to read.
 * @param {string} basePath - The root project path.
 * @param {boolean} deleteComments - Whether to remove comments from file content.
 * @param {Set<string>} llmExcludedPathsSet - A Set of relative paths excluded by the LLM.
 * @param {Array<object>} [fileEntries=[]] - Accumulator for file entries.
 * @returns {Promise<Array<object>>} A list of file objects with their paths and content.
 */
async function readProjectFiles(
    dir,
    basePath,
    removeCommentsFlag,
    llmExcludedPathsSet,
    fileEntries = []
) {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
        console.warn(`Could not read directory ${dir} for file content: ${error.message}`);
        return fileEntries; // Skip directory if unreadable
    }

    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        const relativePath = path.normalize(path.relative(basePath, entryPath));

        // Check against static exclusion list (covers files and directories)
        if (STATIC_EXCLUDE_PATTERNS.some(pattern => 
            entry.name === pattern || // Exact name match (e.g., '.git')
            relativePath === pattern || // Exact relative path match (e.g., 'package-lock.json')
            (entry.isDirectory() && relativePath.startsWith(pattern + path.sep)) || // Directory starts with pattern (e.g., 'node_modules/')
            (!entry.isDirectory() && relativePath.startsWith(pattern + path.sep)) // File within an excluded directory pattern
        )) {
            continue;
        }
        
        if (entry.isDirectory()) {
            await readProjectFiles(entryPath, basePath, removeCommentsFlag, llmExcludedPathsSet, fileEntries);
        } else {
            if (llmExcludedPathsSet.has(relativePath)) {
                fileEntries.push({
                    path: relativePath,
                    content: `**File excluded by LLM filter. The system considers it unnecessary for the current analysis focus.**`,
                    excludedByLLM: true
                });
            } else {
                try {
                    let content = await fs.readFile(entryPath, 'utf8');
                    if (removeCommentsFlag) {
                        content = stripComments(content);
                    }
                    fileEntries.push({ path: relativePath, content, excludedByLLM: false });
                } catch (readError) {
                    console.warn(`Could not read file ${entryPath}: ${readError.message}`);
                    fileEntries.push({
                        path: relativePath,
                        content: `**Could not read file content: ${readError.message}**`,
                        excludedByLLM: false,
                        error: true
                    });
                }
            }
        }
    }
    return fileEntries;
}

/**
 * Removes comments from code content.
 * Handles //, /* ... * /, and # comments.
 * @param {string} content - The code content.
 * @returns {string} Content with comments removed.
 */
function stripComments(content) {
    // Remove block comments /* ... */
    content = content.replace(/\/\*[\s\S]*?\*\/|^\/\*[\s\S]*?\*\//gm, '');
    // Remove single-line comments // ... and # ... (common in Python, shell, Ruby, etc.)
    // Ensures it doesn't remove URLs like http://
    content = content.replace(/(?<!:)\/\/.*$/gm, ''); // JS, C++, Java, etc.
    content = content.replace(/#.*$/gm, '');          // Python, Ruby, Shell, etc.
    return content.replace(/^\s*[\r\n]/gm, ''); // Remove empty lines left by comment removal
}


/**
 * Generates the final Markdown prompt for LLM analysis.
 * @param {string} basePath - The root project path.
 * @param {boolean} deleteComments - Whether to remove comments.
 * @param {number} filterLevel - LLM filtering aggressiveness level.
 * @param {string} [customFocusPrompt=""] - Custom focus for analysis.
 * @returns {Promise<{content: string, suggestedFileName: string | null}>}
 */
async function generateAnalysisMarkdown(basePath, deleteComments, filterLevel = 0, customFocusPrompt = "") {
    console.log(`Generating Markdown prompt. Path: ${basePath}, Remove Comments: ${deleteComments}, LLM Filter Level: ${filterLevel}, Focus: "${customFocusPrompt || 'none'}"`);

    const projectStructureForLLM = await generateFolderStructureString(basePath, basePath);
    
    let llmFilterResult = { excludedFiles: [], suggestedFileName: null };
    if (filterLevel > 0 && OPENAI_API_KEY && OPENAI_API_KEY !== 'YOUR_OPENAI_API_KEY_PLACEHOLDER' && OPENAI_API_KEY.length >= 10) {
        llmFilterResult = await getLLMFilteredExclusions(projectStructureForLLM, filterLevel, basePath, customFocusPrompt);
    }
    
    const llmExcludedPathsSet = new Set(llmFilterResult.excludedFiles.map(p => path.normalize(p)));

    const projectFiles = await readProjectFiles(basePath, basePath, deleteComments, llmExcludedPathsSet);

    let markdownContent = `# Project Analysis Prompt\n\n`;

    if (customFocusPrompt && customFocusPrompt.trim() !== "") {
        markdownContent += `## User-Defined Analysis Focus\n\n`;
        markdownContent += `**The primary goal of this analysis is:**\n`;
        markdownContent += `> ${customFocusPrompt.trim()}\n\n`;
        markdownContent += `Please pay special attention to aspects related to this focus in your file analysis.\n\n`;
    }
    
    if (filterLevel > 0) {
        markdownContent += `**LLM-based file filtering applied (Aggressiveness Level: ${filterLevel})**\n`;
        if (llmFilterResult.excludedFiles.length > 0) {
            markdownContent += `The following files were filtered out (not included in detailed code analysis) based on LLM recommendation:\n`;
            llmFilterResult.excludedFiles.forEach(p => {
                markdownContent += `  - \`${p}\`\n`;
            });
        } else {
            markdownContent += `The LLM filter did not identify additional files for exclusion at this level (or all potential candidates were already in the static exclusion list).\n`;
        }
        markdownContent += `\n`;
    }

    markdownContent += `## Project Directory Structure (after static exclusions)\n\n`;
    markdownContent += `\`\`\`text\n${projectStructureForLLM || "Could not generate directory structure."}\n\`\`\`\n\n`;
    
    markdownContent += `## File Contents (after filtering)\n\n`;
    
    if (projectFiles.length === 0) {
        markdownContent += "No files found for inclusion in the analysis (perhaps all files were filtered, or the directory is empty/inaccessible).\n\n";
    } else {
        projectFiles.forEach(file => {
            markdownContent += `### File: ${file.path}\n\n`;
            if (file.excludedByLLM) {
                markdownContent += `${file.content}\n\n`; 
            } else if (file.error) {
                markdownContent += `\`\`\`text\n${file.content}\n\`\`\`\n\n`;
            } else {
                const extension = path.extname(file.path).substring(1).toLowerCase();
                const lang = extension || 'text'; // Default to 'text' if no extension
                markdownContent += `\`\`\`${lang}\n`;
                markdownContent += `${file.content.trim()}\n`;
                markdownContent += `\`\`\`\n\n`;
            }
        });
    }
    
    return {
        content: markdownContent,
        suggestedFileName: llmFilterResult.suggestedFileName
    };
}

/**
 * Saves the generated prompt to a Markdown file.
 * @param {string} promptContent - The Markdown content to save.
 * @param {string} basePath - The root project path (used for naming context).
 * @param {string | null} [suggestedFileName=null] - An LLM-suggested name part for the file.
 */
async function savePromptToFile(promptContent, basePath, suggestedFileName = null) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHMMSS
    
    const projectDirName = path.basename(path.resolve(basePath)) || 'project';
    let baseNamePart = suggestedFileName || projectDirName;
    
    // Sanitize the name part: allow alphanumeric, hyphens, underscores. Replace others.
    baseNamePart = baseNamePart.replace(/\s+/g, '_').replace(/[^\w\-_]/g, '').slice(0, 50); // Limit length
    if (!baseNamePart) baseNamePart = 'analysis'; // Default if sanitization results in empty string

    const outputFileName = `${dateStr}_${timeStr}_${baseNamePart}.md`; 
    const outputDirectory = path.join(process.cwd(), 'promts'); // Save in 'promts' subdirectory of CWD

    try {
        await fs.mkdir(outputDirectory, { recursive: true });
        const filePath = path.join(outputDirectory, outputFileName);
        await fs.writeFile(filePath, promptContent);
        console.log(`\nPrompt successfully saved to: ${filePath}`);
        if (suggestedFileName) {
            console.log(`Filename includes LLM suggestion: "${suggestedFileName}" (sanitized to: "${baseNamePart}")`);
        }
    } catch (error) {
        console.error('Error saving prompt file:', error);
    }
}

// --- Main Execution ---
async function main() {
    const argv = yargs(hideBin(process.argv))
        .option('deleteComments', {
            alias: 'd',
            type: 'boolean',
            description: 'Remove comments from code before analysis.',
            default: false
        })
        .option('filterLevel', {
            alias: 'f',
            type: 'number',
            description: 'LLM file filtering aggressiveness level (0 = off, 1-5 = min to very aggressive).',
            default: 2 // Default to Light filtering
        })
        .option('focus', {
            alias: 'o', // 'o' for 'objective' or 'orientation'
            type: 'string',
            description: 'Custom prompt (analysis focus) for LLM filter and final analysis. E.g., "Analyze only wallet-service and related authentication logic".',
            default: ''
        })
        .check((argv) => {
            // Using fsSync here as yargs.check is typically synchronous
            const fsSync = require('fs'); // Synchronous fs for this check
            const resolvedFixedPath = path.resolve(HARDCODED_PROJECT_PATH);

            if (!fsSync.existsSync(resolvedFixedPath)) {
                throw new Error(`The hardcoded project path '${HARDCODED_PROJECT_PATH}' (resolved to '${resolvedFixedPath}') does not exist.`);
            }
            if (!fsSync.statSync(resolvedFixedPath).isDirectory()) {
                throw new Error(`The hardcoded project path '${HARDCODED_PROJECT_PATH}' (resolved to '${resolvedFixedPath}') is not a directory.`);
            }

            if (argv.filterLevel < 0 || argv.filterLevel > 5) {
                throw new Error('Filter level (--filterLevel) must be between 0 and 5.');
            }
            return true;
        })
        .help()
        .alias('help', 'h')
        .argv;

    const projectBasePath = path.resolve(HARDCODED_PROJECT_PATH); // Use the hardcoded path
    const { deleteComments, filterLevel: llmFilterLevel, focus: customFocusPrompt } = argv;

    console.log(`\nStarting project analyzer:`);
    console.log(`  Project Directory (Hardcoded): ${projectBasePath}`);
    console.log(`  Remove Comments: ${deleteComments ? 'Yes' : 'No'}`);
    console.log(`  LLM File Filtering: ${llmFilterLevel > 0 ? `Enabled (Level: ${llmFilterLevel})` : 'Disabled'}`);
    if (customFocusPrompt) {
        console.log(`  Custom Analysis Focus: "${customFocusPrompt}"`);
    }
    console.log('---');

    if (llmFilterLevel > 0 && (!OPENAI_API_KEY || OPENAI_API_KEY === 'YOUR_OPENAI_API_KEY_PLACEHOLDER' || OPENAI_API_KEY.length < 10)) {
        console.warn("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.warn("!!! WARNING: LLM filtering requested (level > 0), BUT OPENAI API KEY   !!!");
        console.warn("!!! IS NOT CONFIGURED or is a placeholder 'YOUR_OPENAI_API_KEY_PLACEHOLDER'. !!!");
        console.warn("!!! Please set the OPENAI_API_KEY environment variable.                !!!");
        console.warn("!!! LLM file filtering WILL NOT be performed.                          !!!");
        console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
    }

    try {
        const { content: markdownPrompt, suggestedFileName } = await generateAnalysisMarkdown(
            projectBasePath,
            deleteComments,
            llmFilterLevel,
            customFocusPrompt
        );

        await savePromptToFile(markdownPrompt, projectBasePath, suggestedFileName);

        console.log("\nProcess complete. Analysis prompt generated and saved.");

    } catch (error) { // Catch errors from generateAnalysisMarkdown specifically if needed
        console.error("\n--- Error during Markdown generation or saving ---");
        console.error(error.message);
        // console.error(error.stack); // Uncomment for detailed stack
        process.exit(1);
    }
}

main().catch(error => {
    console.error("\n--- Critical Unhandled Error During Script Execution ---");
    console.error(error.message);
    // console.error(error.stack); // Uncomment for detailed error stack
    process.exit(1); // Exit with an error code
});