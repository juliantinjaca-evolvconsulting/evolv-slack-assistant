/**
 * Slack Block Kit blocks for text responses
 */

/**
 * Convert basic markdown to Slack mrkdwn format
 * @param {string} text - Markdown text
 * @returns {string} - Slack mrkdwn formatted text
 */
function convertToSlackMrkdwn(text) {
    if (!text) return '';
    
    let result = text;
    
    // Convert headers (### -> *bold*)
    result = result.replace(/^###\s+(.+)$/gm, '*$1*');
    result = result.replace(/^##\s+(.+)$/gm, '*$1*');
    result = result.replace(/^#\s+(.+)$/gm, '*$1*');
    
    // Bold: **text** -> *text*
    result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');
    
    // Italic: _text_ stays the same
    // Code: `text` stays the same
    
    // Links: [text](url) -> <url|text>
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
    
    // Bullet points: ensure proper formatting
    result = result.replace(/^[-*]\s+/gm, '• ');
    
    return result;
}

/**
 * Create Slack blocks for a text response
 * @param {string} text - Text content
 * @returns {Array} - Slack Block Kit blocks
 */
function createTextBlocks(text) {
    const blocks = [];
    
    if (!text || !text.trim()) {
        return blocks;
    }
    
    // Convert to Slack format
    const slackText = convertToSlackMrkdwn(text);
    
    // Split into chunks if too long (Slack limit is 3000 chars per section)
    const chunks = [];
    let remaining = slackText;
    
    while (remaining.length > 0) {
        if (remaining.length <= 2900) {
            chunks.push(remaining);
            break;
        }
        
        // Find a good break point
        let breakPoint = remaining.lastIndexOf('\n\n', 2900);
        if (breakPoint === -1 || breakPoint < 1000) {
            breakPoint = remaining.lastIndexOf('\n', 2900);
        }
        if (breakPoint === -1 || breakPoint < 1000) {
            breakPoint = remaining.lastIndexOf(' ', 2900);
        }
        if (breakPoint === -1) {
            breakPoint = 2900;
        }
        
        chunks.push(remaining.substring(0, breakPoint));
        remaining = remaining.substring(breakPoint).trim();
    }
    
    // Create section block for each chunk
    for (const chunk of chunks) {
        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: chunk
            }
        });
    }
    
    return blocks;
}

module.exports = { createTextBlocks, convertToSlackMrkdwn };
