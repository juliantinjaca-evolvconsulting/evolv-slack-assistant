/**
 * Number and data formatting utilities
 */

// Column name patterns that indicate currency/price values
const CURRENCY_PATTERNS = [
    /price/i,
    /cost/i,
    /amount/i,
    /total/i,
    /revenue/i,
    /sales/i,
    /income/i,
    /profit/i,
    /fee/i,
    /charge/i,
    /payment/i,
    /balance/i,
    /budget/i,
    /expense/i
];

/**
 * Check if a column name indicates a currency/price value
 * @param {string} columnName - Name of the column
 * @returns {boolean} - True if it's likely a currency column
 */
function isCurrencyColumn(columnName) {
    if (!columnName) return false;
    return CURRENCY_PATTERNS.some(pattern => pattern.test(columnName));
}

/**
 * Format a value as currency
 * @param {number} value - Number to format
 * @param {string} currency - Currency code (default: USD)
 * @returns {string} - Formatted currency string
 */
function formatCurrency(value, currency = 'USD') {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'number') return String(value);
    
    return value.toLocaleString('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
}

/**
 * Format a number for display (add commas, handle nulls)
 * @param {*} value - Value to format
 * @param {string} columnName - Optional column name to detect formatting
 * @returns {string} - Formatted string
 */
function formatNumber(value, columnName = null) {
    if (value === null || value === undefined) return '';
    
    if (typeof value === 'number') {
        // Check if this is a currency column
        if (columnName && isCurrencyColumn(columnName)) {
            return formatCurrency(value);
        }
        return value.toLocaleString('en-US');
    }
    
    return String(value);
}

/**
 * Format a value with column context (name and type)
 * @param {*} value - Value to format
 * @param {string} columnName - Column name
 * @param {string} columnType - Snowflake column type (optional)
 * @returns {string} - Formatted string
 */
function formatValue(value, columnName, columnType = null) {
    if (value === null || value === undefined) return '';
    
    // Convert string numbers to actual numbers
    let numValue = value;
    if (typeof value === 'string' && !isNaN(value) && value.trim() !== '') {
        numValue = parseFloat(value);
    }
    
    // Check for currency by column name
    if (typeof numValue === 'number' && !isNaN(numValue) && isCurrencyColumn(columnName)) {
        return formatCurrency(numValue);
    }
    
    // Check for percentage
    if (typeof numValue === 'number' && !isNaN(numValue) && /percent|pct|ratio/i.test(columnName)) {
        return (numValue * (numValue <= 1 ? 100 : 1)).toFixed(1) + '%';
    }
    
    // Default number formatting
    if (typeof numValue === 'number' && !isNaN(numValue)) {
        return Math.round(numValue).toLocaleString('en-US');
    }
    
    return String(value);
}

/**
 * Format large numbers with scale suffix (K, M, B)
 * @param {number} value - Number to format
 * @returns {string} - Formatted string with suffix
 */
function formatWithScale(value) {
    if (typeof value !== 'number') return String(value);
    
    if (value >= 1e9) {
        return (value / 1e9).toFixed(1) + 'B';
    } else if (value >= 1e6) {
        return (value / 1e6).toFixed(1) + 'M';
    } else if (value >= 1e3) {
        return (value / 1e3).toFixed(1) + 'K';
    }
    return value.toLocaleString('en-US');
}

/**
 * Determine scale factor for a set of values
 * @param {number[]} values - Array of numbers
 * @returns {{factor: number, suffix: string}} - Scale factor and suffix
 */
function determineScale(values) {
    const maxValue = Math.max(...values.filter(v => typeof v === 'number'));
    
    if (maxValue >= 1e9) {
        return { factor: 1e9, suffix: 'B' };
    } else if (maxValue >= 1e6) {
        return { factor: 1e6, suffix: 'M' };
    } else if (maxValue >= 1e3) {
        return { factor: 1e3, suffix: 'K' };
    }
    return { factor: 1, suffix: '' };
}

module.exports = {
    formatNumber,
    formatCurrency,
    formatValue,
    formatWithScale,
    determineScale,
    isCurrencyColumn
};
