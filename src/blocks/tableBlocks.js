/**
 * Slack Block Kit blocks for tables
 * Supports both text-based and image-based table rendering
 */
const { formatValue } = require('../utils/formatters');
const { resultSetToImage } = require('../utils/tableToImage');
const fs = require('fs');
const CONSTANTS = require('../config/constants');

const MAX_ROWS = CONSTANTS.TABLE.TEXT_MAX_ROWS;
const MAX_COLS = CONSTANTS.TABLE.TEXT_MAX_COLS;
const USE_TABLE_IMAGES = true; // Set to false to use text-based tables

/**
 * Create Slack blocks for a table response (text-based fallback)
 * @param {Object} resultSet - Result set with metadata and data
 * @param {string} title - Optional title
 * @returns {Array} - Slack Block Kit blocks
 */
function createTableBlocks(resultSet, title) {
    const blocks = [];
    
    // Get columns and rows
    const columns = resultSet.resultSetMetaData?.rowType?.map(col => col.name) || [];
    const rows = resultSet.data || [];
    
    if (columns.length === 0 || rows.length === 0) {
        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: "_No data available_"
            }
        });
        return blocks;
    }
    
    // Title if provided
    if (title) {
        blocks.push({
            type: "header",
            text: {
                type: "plain_text",
                text: title.substring(0, CONSTANTS.SLACK.HEADER_MAX_LENGTH),
                emoji: true
            }
        });
    }
    
    // Limit columns and rows
    const displayColumns = columns.slice(0, MAX_COLS);
    const displayRows = rows.slice(0, MAX_ROWS);
    
    // Build markdown table using code blocks
    let tableText = '```\n';
    tableText += displayColumns.map(col => col.replace(/_/g, ' ')).join(' | ') + '\n';
    tableText += displayColumns.map(() => '---').join(' | ') + '\n';
    
    displayRows.forEach(row => {
        const rowValues = displayColumns.map((col, idx) => {
            const value = formatValue(row[idx], col);
            return value || '-';
        });
        tableText += rowValues.join(' | ') + '\n';
    });
    tableText += '```';
    
    blocks.push({
        type: "section",
        text: {
            type: "mrkdwn",
            text: tableText.substring(0, 3000)
        }
    });
    
    // Truncation message
    if (rows.length > MAX_ROWS || columns.length > MAX_COLS) {
        let contextText = '';
        if (rows.length > MAX_ROWS) {
            contextText += `Showing ${MAX_ROWS} of ${rows.length} rows`;
        }
        if (columns.length > MAX_COLS) {
            contextText += contextText ? ', ' : '';
            contextText += `${MAX_COLS} of ${columns.length} columns`;
        }
        
        blocks.push({
            type: "context",
            elements: [{
                type: "mrkdwn",
                text: contextText
            }]
        });
    }
    
    return blocks;
}

/**
 * Upload table as image to Slack and send as message
 * @param {Object} client - Slack client
 * @param {string} channel - Channel ID
 * @param {string} threadTs - Thread timestamp
 * @param {Object} resultSet - Result set with metadata and data
 * @param {string} title - Optional title
 * @returns {Promise<boolean>} - True if image was sent, false to use fallback
 */
async function sendTableAsImage(client, channel, threadTs, resultSet, title) {
    if (!USE_TABLE_IMAGES) return false;
    
    const columns = resultSet.resultSetMetaData?.rowType?.map(col => col.name) || [];
    const rows = resultSet.data || [];
    
    if (columns.length === 0 || rows.length === 0) return false;
    
    try {
        // Generate image
        const imagePath = await resultSetToImage(resultSet, title, MAX_ROWS, MAX_COLS);
        
        // Upload to Slack
        const result = await client.files.uploadV2({
            channel_id: channel,
            thread_ts: threadTs,
            file: fs.createReadStream(imagePath),
            filename: 'table.png',
            title: title || 'Query Results',
            initial_comment: title ? '' : undefined
        });
        
        // Clean up temp file
        fs.unlink(imagePath, () => {});
        
        return true;
    } catch (err) {
        console.error('Failed to send table as image:', err.message);
        return false;
    }
}

module.exports = { 
    createTableBlocks,
    sendTableAsImage,
    USE_TABLE_IMAGES
};
