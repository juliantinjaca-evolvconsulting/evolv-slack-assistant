/**
 * Slack Block Kit blocks for charts
 */
const { generateChartUrl } = require('../utils/chartUtils');

const MAX_TABLE_ROWS = 10;

/**
 * Create Slack blocks for a chart response
 * @param {Object} chartData - Chart data with spec
 * @returns {Array} - Slack Block Kit blocks
 */
function createChartBlocks(chartData) {
    const blocks = [];
    
    // Title
    const title = chartData.spec?.title || "Results";
    blocks.push({
        type: "header",
        text: {
            type: "plain_text",
            text: title.substring(0, 150),
            emoji: true
        }
    });
    
    // Generate chart image URL via Kroki
    const chartUrl = generateChartUrl(chartData.spec);
    
    if (chartUrl) {
        blocks.push({
            type: "image",
            image_url: chartUrl,
            alt_text: title
        });
    }
    
    // If chart has embedded data, show a summary
    if (chartData.spec?.data?.values?.length > 0) {
        const rowCount = chartData.spec.data.values.length;
        blocks.push({
            type: "context",
            elements: [{
                type: "mrkdwn",
                text: `Chart based on ${rowCount} data points`
            }]
        });
    }
    
    return blocks;
}

module.exports = { createChartBlocks };
