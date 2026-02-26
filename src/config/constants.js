/**
 * Application constants - centralized configuration values
 * These are compile-time constants that don't change per environment.
 * For environment-specific values, use .env variables.
 */

module.exports = {
    // Slack API Limits
    SLACK: {
        MAX_MESSAGE_LENGTH: 4000,        // Max input message length
        MAX_BLOCKS: 50,                  // Max blocks per message
        HEADER_MAX_LENGTH: 150,          // Max header text length
        SECTION_TEXT_MAX: 3000,          // Max section text length
        SECTION_TEXT_SAFE: 2900          // Safe section text length for chunking
    },

    // Snowflake/API Configuration
    API: {
        DEFAULT_TIMEOUT_MS: 30000,       // Default HTTP request timeout
        SQL_TIMEOUT_SECONDS: 60,         // SQL execution timeout
        SQL_POLL_MAX_ATTEMPTS: 30,       // Max polling attempts for async SQL
        SQL_POLL_INTERVAL_MS: 1000,      // Polling interval for async SQL
        STREAM_TIMEOUT_MULTIPLIER: 4     // Multiplier for streaming timeout
    },

    // JWT Token Configuration
    JWT: {
        LIFETIME_SECONDS: 55 * 60,       // 55 minutes
        RENEWAL_DELAY_SECONDS: 50 * 60   // 50 minutes - renew before expiry
    },

    // Thread Configuration
    THREADS: {
        TTL_DAYS: 7,                     // Thread time-to-live in days
        MAX_MESSAGES_FETCH: 1000,        // Max messages to fetch per thread
        DEFAULT_PAGE_SIZE: 100,          // Default page size for pagination
        PAGE_SIZE_MIN: 1,
        PAGE_SIZE_MAX: 100,
        ORIGIN_APPLICATION: 'slack_bot',
        MAX_ORIGIN_APP_LENGTH: 16
    },

    // Table Display Configuration
    TABLE: {
        // Text-based tables (markdown)
        TEXT_MAX_ROWS: 10,
        TEXT_MAX_COLS: 5,
        // Image-based tables (Playwright)
        IMAGE_MAX_ROWS: 15,
        IMAGE_MAX_COLS: 6,
        CELL_MAX_LENGTH: 40              // Max characters per cell before truncation
    },

    // Streaming/Throttling Configuration
    STREAM: {
        THROTTLE_MIN_INTERVAL_MS: 600,   // Min time between Slack updates
        THROTTLE_MIN_CHARS: 50,          // Min characters before update
        STATUS_UPDATE_INTERVAL_MS: 500,  // Status message throttle
        TYPING_CURSOR: ' \u258c'              // Typing indicator character
    },

    // Chart Configuration
    CHART: {
        DEFAULT_WIDTH: 500,
        DEFAULT_HEIGHT: 350,
        MAX_KROKI_URL_LENGTH: 8000
    },

    // File/URL Configuration
    FILES: {
        PRESIGNED_URL_EXPIRATION_SECONDS: 3600  // 1 hour
    },

    // Locale Configuration
    LOCALE: {
        DEFAULT: 'en-US',
        CURRENCY: 'USD'
    },

    // Share Intent Keywords
    SHARE_KEYWORDS: ['share', 'send', 'notify', 'tell']
};
