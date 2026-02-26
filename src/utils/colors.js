/**
 * Centralized brand color palette
 * Use these constants throughout the app for consistency
 */

const COLORS = {
    // Primary brand colors
    primary: '#D15635',      // Orange - main brand color
    secondary: '#2E3952',    // Dark blue - headers, accents
    
    // Neutrals
    dark: '#343434',         // Dark text
    text: '#1a1a1a',         // Primary text
    textMuted: '#333333',    // Secondary text
    grey: '#D9D9D9',         // Borders, dividers
    lightGrey: '#e0e0e0',    // Table borders
    
    // Backgrounds
    background: '#ffffff',
    backgroundAlt: '#f8f9fa',    // Alternating rows
    backgroundHover: '#e8f4fc',  // Hover states
    
    // Accent colors
    lightOrange: '#D68B60'   // Secondary accent
};

// Semantic aliases for specific use cases
const TABLE_COLORS = {
    headerBg: COLORS.secondary,
    headerText: '#ffffff',
    headerBorder: COLORS.secondary,
    cellBorder: COLORS.lightGrey,
    rowAlt: COLORS.backgroundAlt,
    rowHover: COLORS.backgroundHover
};

const CHART_COLORS = {
    bar: COLORS.secondary,
    pie: [COLORS.primary, COLORS.secondary, COLORS.lightOrange, COLORS.grey],
    line: COLORS.secondary
};

module.exports = {
    COLORS,
    TABLE_COLORS,
    CHART_COLORS
};
