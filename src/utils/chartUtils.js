/**
 * Chart utilities for Kroki rendering
 */
const zlib = require('zlib');
const { COLORS, CHART_COLORS } = require('./colors');

const DEBUG = process.env.DEBUG_CORTEX === 'true';

// Configurable Kroki URL (allows self-hosting)
const KROKI_URL = process.env.KROKI_URL || 'https://kroki.io';

// Maximum URL length for Kroki (to prevent errors with large specs)
const MAX_KROKI_URL_LENGTH = 8000;

// Legacy alias for backwards compatibility
const BRAND_COLORS = {
    orange: COLORS.primary,
    dark: COLORS.dark,
    grey: COLORS.grey,
    blue: COLORS.secondary,
    lightOrange: COLORS.lightOrange
};

/**
 * Generate Kroki URL from Vega-Lite spec
 * @param {Object} vegaSpec - Vega-Lite specification
 * @param {number} width - Chart width
 * @param {number} height - Chart height
 * @returns {string|null} - Kroki URL or null
 */
function generateChartUrl(vegaSpec, width = 500, height = 350) {
    if (!vegaSpec) return null;
    
    // Add dimensions and styling, remove title (we'll show it separately)
    const { title, ...specWithoutTitle } = vegaSpec;
    
    const styledSpec = {
        ...specWithoutTitle,
        width: width,
        height: height,
        config: {
            ...vegaSpec.config,
            bar: {
                color: BRAND_COLORS.blue
            },
            arc: {
                stroke: '#fff'
            }
        }
    };
    
    if (DEBUG) {
        console.log('>>> Vega-Lite spec for Kroki:', JSON.stringify(styledSpec, null, 2).substring(0, 800));
    }
    
    // Kroki expects deflate compressed + base64url encoded spec
    const specJson = JSON.stringify(styledSpec);
    const compressed = zlib.deflateSync(specJson);
    const base64Spec = compressed.toString('base64url');
    
    const url = `${KROKI_URL}/vegalite/png/${base64Spec}`;
    
    // Validate URL length to prevent Kroki errors
    if (url.length > MAX_KROKI_URL_LENGTH) {
        console.warn(`Chart URL too long (${url.length} chars), may fail. Consider simplifying the chart.`);
        return null;
    }
    
    if (DEBUG) {
        console.log('>>> Kroki URL length:', url.length);
    }
    
    return url;
}

module.exports = {
    generateChartUrl,
    BRAND_COLORS
};
