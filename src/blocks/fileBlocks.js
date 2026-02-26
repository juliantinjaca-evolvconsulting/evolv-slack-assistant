/**
 * Slack Block Kit blocks for file download buttons
 */

/**
 * Default stage for generated files (PPTX, PDF, etc.)
 * Used when the agent output only contains a bare filename without the full stage path
 */
const DEFAULT_OUTPUT_STAGE = process.env.PPTX_OUTPUT_STAGE || 'SALES_ASSIST_DELIVERY_ACCELERATORS.SALES_ASSISTANT_MVP.PPTX_OUTPUT_STAGE';

/**
 * Regex to detect Snowflake stage file paths in text
 * Matches patterns like: @DATABASE.SCHEMA.STAGE/filename.ext
 */
const STAGE_FILE_REGEX = /@([A-Z0-9_]+\.[A-Z0-9_]+\.[A-Z0-9_]+)\/([^\s\n]+\.(pptx|pdf|xlsx|csv|zip))/gi;

/**
 * Regex to detect bare filenames (without stage prefix)
 * Matches patterns like: filename.pptx, my_report.pdf
 * Looks for "File:" or "Archivo:" prefix
 */
const BARE_FILE_REGEX = /(?:(?:Archivo|File)\s*:\s*)([a-z0-9_\-]+(?:\.[a-z0-9_\-]+)*\.(pptx|pdf|xlsx|csv|zip))/gi;

/**
 * Extract stage file references from text
 * First tries full stage paths (@DB.SCHEMA.STAGE/file), then bare filenames
 * @param {string} text - Text that may contain file references
 * @returns {Array<{fullMatch: string, stageName: string, fileName: string, extension: string}>}
 */
function extractStageFiles(text) {
    if (!text) return [];
    
    const matches = [];
    const foundFileNames = new Set();
    let match;
    
    // First: try full stage paths
    STAGE_FILE_REGEX.lastIndex = 0;
    while ((match = STAGE_FILE_REGEX.exec(text)) !== null) {
        matches.push({
            fullMatch: match[0],
            stageName: match[1],
            fileName: match[2],
            extension: match[3].toLowerCase()
        });
        foundFileNames.add(match[2].toLowerCase());
    }
    
    // Second: try bare filenames (with "File:" or "Archivo:" prefix)
    BARE_FILE_REGEX.lastIndex = 0;
    while ((match = BARE_FILE_REGEX.exec(text)) !== null) {
        const fileName = match[1];
        if (!foundFileNames.has(fileName.toLowerCase())) {
            matches.push({
                fullMatch: match[0],
                stageName: DEFAULT_OUTPUT_STAGE,
                fileName: fileName,
                extension: match[2].toLowerCase()
            });
            foundFileNames.add(fileName.toLowerCase());
        }
    }
    
    // Third: detect standalone .pptx filenames not preceded by "File:/Archivo:"
    // Match filenames that appear on their own (word boundary)
    if (matches.length === 0) {
        const standaloneRegex = /\b([a-z0-9_\-]+(?:\.[a-z0-9_\-]+)*\.(pptx|pdf|xlsx))\b/gi;
        while ((match = standaloneRegex.exec(text)) !== null) {
            const fileName = match[1];
            if (!foundFileNames.has(fileName.toLowerCase())) {
                matches.push({
                    fullMatch: match[0],
                    stageName: DEFAULT_OUTPUT_STAGE,
                    fileName: fileName,
                    extension: match[2].toLowerCase()
                });
                foundFileNames.add(fileName.toLowerCase());
            }
        }
    }
    
    return matches;
}

/**
 * Remove stage file paths and bare filenames from text, leaving the surrounding content clean
 * @param {string} text - Text containing file references
 * @returns {string} - Cleaned text
 */
function removeStageFilePaths(text) {
    if (!text) return text;
    // Remove lines containing "Archivo:" or "File:" followed by a stage path
    let cleaned = text.replace(/^.*(?:Archivo|File)\s*:\s*@[A-Z0-9_]+\.[A-Z0-9_]+\.[A-Z0-9_]+\/[^\n]+$/gmi, '');
    // Remove lines containing "Archivo:" or "File:" followed by a bare filename
    cleaned = cleaned.replace(/^.*(?:Archivo|File)\s*:\s*[a-z0-9_\-]+(?:\.[a-z0-9_\-]+)*\.(?:pptx|pdf|xlsx|csv|zip)\s*$/gmi, '');
    // Remove any standalone stage paths
    STAGE_FILE_REGEX.lastIndex = 0;
    cleaned = cleaned.replace(STAGE_FILE_REGEX, '');
    // Clean up extra blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    return cleaned.trim();
}

/**
 * Create Slack blocks with a download button for a file
 * @param {string} fileName - Name of the file
 * @param {string} presignedUrl - Presigned URL for downloading
 * @param {string} extension - File extension
 * @returns {Array} Slack Block Kit blocks
 */
function createFileDownloadBlocks(fileName, presignedUrl, extension) {
    return [
        { type: "divider" },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*Generated file:* \`${fileName}\``
            },
            accessory: {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "Download"
                },
                url: presignedUrl,
                style: "primary",
                action_id: "download_file"
            }
        }
    ];
}

module.exports = { 
    extractStageFiles, 
    removeStageFilePaths, 
    createFileDownloadBlocks,
    STAGE_FILE_REGEX 
};
