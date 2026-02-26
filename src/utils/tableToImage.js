/**
 * Convert table data to image using Playwright
 * Renders HTML table and captures screenshot
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { COLORS, TABLE_COLORS } = require('./colors');
const CONSTANTS = require('../config/constants');

// Reuse browser instance for performance
let browserInstance = null;

async function getBrowser() {
    // Check if browser is still connected, recreate if not
    if (browserInstance && !browserInstance.isConnected()) {
        console.warn('Browser instance disconnected, recreating...');
        browserInstance = null;
    }
    
    if (!browserInstance) {
        browserInstance = await chromium.launch({ headless: true });
    }
    return browserInstance;
}

/**
 * Gracefully close browser instance
 */
async function closeBrowser() {
    if (browserInstance) {
        try {
            await browserInstance.close();
        } catch (e) {
            console.error('Error closing browser:', e.message);
        }
        browserInstance = null;
    }
}

/**
 * Generate HTML for a styled table
 */
function generateTableHtml(options) {
    const { title = '', columns = [], rows = [] } = options;
    
    const headerCells = columns.map(col => 
        `<th>${escapeHtml(String(col).replace(/_/g, ' '))}</th>`
    ).join('');
    
    const bodyRows = rows.map(row => {
        const cells = row.map((cell, idx) => {
            const formatted = formatCellValue(cell, columns[idx]);
            return `<td>${escapeHtml(formatted)}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');
    
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            background: ${COLORS.background};
            min-width: 800px;
        }
        h2 {
            color: ${COLORS.text};
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            font-size: 14px;
        }
        th {
            background: ${TABLE_COLORS.headerBg};
            color: ${TABLE_COLORS.headerText};
            font-weight: 600;
            text-align: left;
            padding: 10px 16px;
            border: 1px solid ${TABLE_COLORS.headerBorder};
            white-space: nowrap;
        }
        td {
            padding: 8px 16px;
            border: 1px solid ${TABLE_COLORS.cellBorder};
            color: ${COLORS.textMuted};
            white-space: nowrap;
        }
        tr:nth-child(even) {
            background: ${TABLE_COLORS.rowAlt};
        }
        tr:hover {
            background: ${TABLE_COLORS.rowHover};
        }
        .number {
            text-align: right;
            font-variant-numeric: tabular-nums;
        }
    </style>
</head>
<body>
    ${title ? `<h2>${escapeHtml(title)}</h2>` : ''}
    <table>
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
    </table>
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Format cell value for display
 */
function formatCellValue(value, columnName) {
    if (value === null || value === undefined) return '-';
    
    // Try to convert string numbers to actual numbers
    let numValue = value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = parseFloat(value.replace(/,/g, ''));
        if (!isNaN(parsed)) {
            numValue = parsed;
        }
    }
    
    // Number formatting
    if (typeof numValue === 'number') {
        const colName = (columnName || '').toLowerCase();
        // Check if it looks like currency based on column name
        const isCurrency = /amount|value|total|revenue|pipeline|price/i.test(colName);
        // Check if it's a count (keep as integer)
        const isCount = /count/i.test(colName);
        // Check if it's an aggregation that needs decimal formatting
        const isAggregation = /avg|average|sum|min|max|mean|median|std|variance/i.test(colName);
        
        if (isCurrency) {
            return `$${numValue.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        if (isCount) {
            return Math.round(numValue).toLocaleString('es-ES');
        }
        if (isAggregation) {
            return numValue.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        if (Number.isInteger(numValue)) {
            return numValue.toLocaleString('es-ES');
        }
        return numValue.toLocaleString('es-ES', { maximumFractionDigits: 2 });
    }
    
    // Truncate long strings
    const str = String(value);
    return str.length > 40 ? str.substring(0, 37) + '...' : str;
}

/**
 * Generate table image and save to temp file
 * @param {Object} options - Table options
 * @param {string} options.title - Table title
 * @param {Array<string>} options.columns - Column headers
 * @param {Array<Array>} options.rows - Row data
 * @param {number} options.scale - Image scale factor (default: 2)
 * @returns {Promise<string>} - Path to generated image
 */
async function generateTableImage(options) {
    const { scale = 2 } = options;
    const html = generateTableHtml(options);
    const browser = await getBrowser();
    const page = await browser.newPage({
        deviceScaleFactor: scale
    });
    
    try {
        await page.setContent(html);
        
        // Wait for content to render
        await page.waitForLoadState('domcontentloaded');
        
        // Get the body dimensions
        const bodyHandle = await page.$('body');
        const boundingBox = await bodyHandle.boundingBox();
        
        // Set viewport to fit content
        await page.setViewportSize({
            width: Math.ceil(boundingBox.width) + 32,
            height: Math.ceil(boundingBox.height) + 32
        });
        
        // Generate unique filename
        const filename = `table_${Date.now()}.png`;
        const filepath = path.join(os.tmpdir(), filename);
        
        // Take screenshot with scale
        await page.screenshot({ 
            path: filepath,
            fullPage: true,
            type: 'png'
        });
        
        return filepath;
    } finally {
        await page.close();
    }
}

/**
 * Generate table image from Snowflake result set
 * @param {Object} resultSet - Snowflake result set with metadata and data
 * @param {string} title - Optional title
 * @param {number} maxRows - Maximum rows to display (default: 15)
 * @param {number} maxCols - Maximum columns to display (default: 6)
 * @returns {Promise<string>} - Path to generated image
 */
async function resultSetToImage(resultSet, title = '', maxRows = CONSTANTS.TABLE.IMAGE_MAX_ROWS, maxCols = CONSTANTS.TABLE.IMAGE_MAX_COLS) {
    const columns = resultSet.resultSetMetaData?.rowType?.map(col => 
        col.name.replace(/_/g, ' ')
    ) || [];
    const rows = resultSet.data || [];
    
    // Limit data
    const displayColumns = columns.slice(0, maxCols);
    const displayRows = rows.slice(0, maxRows).map(row => row.slice(0, maxCols));
    
    return generateTableImage({
        title,
        columns: displayColumns,
        rows: displayRows
    });
}

/**
 * Create Slack blocks with table image (requires file upload first)
 * @param {string} imageUrl - Public URL of uploaded image
 * @param {string} altText - Alt text for accessibility
 * @param {string} title - Optional title
 * @returns {Array} - Slack Block Kit blocks
 */
function createTableImageBlocks(imageUrl, altText = 'Data Table', title = '') {
    const blocks = [];
    
    if (title) {
        blocks.push({
            type: 'header',
            text: {
                type: 'plain_text',
                text: title.substring(0, 150),
                emoji: true
            }
        });
    }
    
    blocks.push({
        type: 'image',
        image_url: imageUrl,
        alt_text: altText
    });
    
    return blocks;
}

/**
 * Cleanup browser on process termination signals
 */
const handleShutdown = async (signal) => {
    console.log(`Received ${signal}, closing browser...`);
    await closeBrowser();
    process.exit(0);
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = {
    generateTableImage,
    resultSetToImage,
    createTableImageBlocks,
    formatCellValue,
    generateTableHtml
};
