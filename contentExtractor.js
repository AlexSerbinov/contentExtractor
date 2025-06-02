// Node.js built-in modules
const fs = require('fs').promises;
const path = require('path');

// --- Configuration Constants ---
const PROMPT_OUTPUT_DIR = './promts'; // Directory to save generated prompts

// List of file and folder names to exclude from scanning and analysis
const EXCLUDE_PATTERNS = [
    '.DS_Store',
    'node_modules',
    '.git',
    '.gitignore',
    '.prettierrc',
    'package-lock.json',
    'yarn.lock',
    path.basename(PROMPT_OUTPUT_DIR) // Exclude the output directory itself
];

/**
 * Generates a string representation of the folder structure.
 * @param {string} dirPath - The current directory to scan.
 * @param {string} prefix - The prefix for visual indentation of the structure.
 * @returns {Promise<string>} A string representing the folder structure.
 */
async function generateFolderStructureString(dirPath, prefix = '') {
    let structureString = '';
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (EXCLUDE_PATTERNS.some(excludePattern => entry.name === excludePattern)) {
                continue;
            }
            structureString += `${prefix}-- ${entry.name}${entry.isDirectory() ? '/' : ''}\n`;
            if (entry.isDirectory()) {
                const subDirPath = path.join(dirPath, entry.name);
                structureString += await generateFolderStructureString(subDirPath, prefix + '  ');
            }
        }
    } catch (error) {
        console.warn(`Could not read directory for structure generation ${dirPath}: ${error.message}`);
        structureString += `${prefix}  Error reading directory: ${error.message}\n`;
    }
    return structureString;
}

/**
 * Reads all files in a directory recursively, excluding specified patterns.
 * @param {string} dirPath - The directory to read.
 * @param {boolean} [shouldRemoveComments=false] - Whether to remove comments from file content.
 * @param {Array<object>} [fileListAccumulator=[]] - Accumulator for file data.
 * @returns {Promise<Array<object>>} A list of objects, each with 'filePath' and 'content'.
 */
async function readDirectoryContentsRecursive(dirPath, shouldRemoveComments = false, fileListAccumulator = []) {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (EXCLUDE_PATTERNS.some(excludePattern => entry.name === excludePattern)) {
                continue;
            }
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                await readDirectoryContentsRecursive(fullPath, shouldRemoveComments, fileListAccumulator);
            } else {
                try {
                    let content = await fs.readFile(fullPath, 'utf8');
                    if (shouldRemoveComments) {
                        content = stripComments(content);
                    }
                    fileListAccumulator.push({ filePath: fullPath, content });
                } catch (readError) {
                    console.warn(`Could not read file ${fullPath}: ${readError.message}`);
                    fileListAccumulator.push({
                        filePath: fullPath,
                        content: `Error: Could not read file content. ${readError.message}`
                    });
                }
            }
        }
    } catch (error) {
        console.warn(`Could not read directory ${dirPath}: ${error.message}`);
    }
    return fileListAccumulator;
}

/**
 * Removes single-line (//) and multi-line (/* ... * /) comments from a string.
 * @param {string} codeContent - The code content as a string.
 * @returns {string} The code content with comments removed.
 */
function stripComments(codeContent) {
    // Remove single-line comments (e.g., // comment)
    codeContent = codeContent.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments (e.g., /* comment */)
    codeContent = codeContent.replace(/\/\*[\s\S]*?\*\//gm, '');
    // Optional: Remove empty lines that might result from comment removal
    codeContent = codeContent.replace(/^\s*[\r\n]/gm, '');
    return codeContent;
}

/**
 * Prepares file content for analysis by reading files and making paths relative.
 * @param {string} projectBasePath - The root path of the project.
 * @param {boolean} [shouldRemoveComments=false] - Whether to remove comments.
 * @returns {Promise<Array<object>>} Array of objects with 'path' (relative) and 'content'.
 */
async function prepareProjectContentForAnalysis(projectBasePath, shouldRemoveComments = false) {
    const allFilesData = await readDirectoryContentsRecursive(projectBasePath, shouldRemoveComments);
    const analysisData = allFilesData.map(fileData => ({
        path: path.relative(projectBasePath, fileData.filePath),
        content: fileData.content,
    }));
    return analysisData;
}

/**
 * Generates a Markdown-formatted string containing project structure and file contents.
 * This string is intended to be used as a prompt for an LLM or for manual review.
 * @param {string} projectBasePath - The root path of the project.
 * @param {boolean} shouldRemoveComments - Whether to remove comments from code.
 * @returns {Promise<string>} A Markdown string.
 */
async function generateProjectMarkdown(projectBasePath, shouldRemoveComments) {
    console.log(`Generating Markdown data for project at: ${projectBasePath}`);
    const projectStructureString = await generateFolderStructureString(projectBasePath);
    const projectFileContents = await prepareProjectContentForAnalysis(projectBasePath, shouldRemoveComments);

    let markdownContent = `# Project Overview\n\n`; // Changed title slightly
    markdownContent += `## Directory Structure\n\n`;
    markdownContent += `\`\`\`text\n${projectStructureString}\n\`\`\`\n\n`;

    markdownContent += `## File Contents\n\n`;

    if (projectFileContents.length === 0) {
        markdownContent += "No files found or all files were excluded.\n\n";
    } else {
        projectFileContents.forEach(file => {
            const extension = path.extname(file.path).substring(1).toLowerCase();
            const language = extension || 'text'; // Default to 'text' if no extension

            markdownContent += `### File: ${file.path}\n\n`;
            markdownContent += `\`\`\`${language}\n`;
            markdownContent += `${file.content.trim()}\n`; // Trim to remove extraneous whitespace
            markdownContent += `\`\`\`\n\n`;
        });
    }

    return markdownContent;
}

/**
 * Saves the generated content to a Markdown file.
 * @param {string} markdownContent - The Markdown content to save.
 */
async function saveMarkdownToFile(markdownContent) {
    const now = new Date();
    // Format: YYYY-MM-DDTHH-MM-SS
    const dateTimeString = now.toISOString().replace(/:/g, '-').split('.')[0];
    const outputFileName = `project-overview-${dateTimeString}.md`; // Changed filename slightly

    try {
        await fs.mkdir(PROMPT_OUTPUT_DIR, { recursive: true }); // Ensure output directory exists
        const filePath = path.join(PROMPT_OUTPUT_DIR, outputFileName);
        console.log(markdownContent)
        await fs.writeFile(filePath, markdownContent);
        console.log(`\nProject overview successfully saved to: ${filePath}`);
    } catch (error) {
        console.error('Error saving Markdown file:', error);
    }
}

/**
 * Main function to orchestrate the script.
 */
async function main() {
    // Configuration: These could be made dynamic (e.g., command-line arguments)
    const projectBasePath = './files_to_extract/'; // Path to the project directory to analyze
    const shouldRemoveComments = false;         // Set to true to remove comments from code

    console.log("Starting project data extraction...");

    // Generate the Markdown content
    const projectMarkdown = await generateProjectMarkdown(projectBasePath, shouldRemoveComments);

    // Save the generated Markdown to a file
    await saveMarkdownToFile(projectMarkdown);

    console.log("\nScript finished.");
}

// Execute the main function and catch any unhandled errors
main().catch(error => {
    console.error("An unexpected error occurred in main execution:", error);
    process.exit(1); // Exit with an error code
});