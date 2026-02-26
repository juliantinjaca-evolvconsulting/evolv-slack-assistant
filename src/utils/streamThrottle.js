/**
 * StreamThrottle - Rate-limited streaming for Slack message updates
 * 
 * Slack API has rate limits (~1 update/second per message).
 * This utility buffers tokens and flushes updates at safe intervals.
 */

const CONSTANTS = require('../config/constants');

class StreamThrottle {
    /**
     * @param {Object} options - Configuration options
     * @param {number} options.minInterval - Minimum ms between updates (default: 600ms)
     * @param {number} options.minChars - Minimum characters before forcing update (default: 50)
     * @param {Function} options.onFlush - Callback when buffer is flushed: (fullText) => Promise
     * @param {boolean} options.overwrite - If true, replace text instead of appending (default: false)
     */
    constructor(options = {}) {
        this.minInterval = options.minInterval || CONSTANTS.STREAM.THROTTLE_MIN_INTERVAL_MS;
        this.minChars = options.minChars || CONSTANTS.STREAM.THROTTLE_MIN_CHARS;
        this.onFlush = options.onFlush || (() => {});
        this.overwrite = options.overwrite || false;
        
        this.buffer = '';
        this.fullText = '';
        this.lastFlush = 0;
        this.flushTimeout = null;
        this.isComplete = false;
    }

    /**
     * Add token to buffer and potentially trigger flush
     * @param {string} token - Token chunk to add
     */
    async push(token) {
        if (this.isComplete) return;
        
        if (this.overwrite) {
            this.buffer = token;
            this.fullText = token;
        } else {
            this.buffer += token;
            this.fullText += token;
        }
        
        const now = Date.now();
        const timeSinceLastFlush = now - this.lastFlush;
        
        // Flush if enough time has passed OR enough characters accumulated
        if (timeSinceLastFlush >= this.minInterval || this.buffer.length >= this.minChars) {
            await this._flush();
        } else if (!this.flushTimeout) {
            // Schedule a flush for remaining time
            const remaining = this.minInterval - timeSinceLastFlush;
            this.flushTimeout = setTimeout(() => this._flush(), remaining);
        }
    }

    /**
     * Force final flush and mark as complete
     */
    async complete() {
        if (this.isComplete) return;
        this.isComplete = true;
        
        if (this.flushTimeout) {
            clearTimeout(this.flushTimeout);
            this.flushTimeout = null;
        }
        
        // Final flush if there's remaining buffer
        if (this.buffer.length > 0) {
            await this._flush();
        }
    }

    /**
     * Get the full accumulated text
     * @returns {string}
     */
    getText() {
        return this.fullText;
    }

    /**
     * Internal flush method
     */
    async _flush() {
        if (this.flushTimeout) {
            clearTimeout(this.flushTimeout);
            this.flushTimeout = null;
        }
        
        if (this.buffer.length === 0) return;
        
        this.buffer = '';
        this.lastFlush = Date.now();
        
        try {
            await this.onFlush(this.fullText);
        } catch (error) {
            // Log but don't throw - we don't want to break the stream
            console.error('[StreamThrottle] Flush error:', error.message);
        }
    }
}

/**
 * Create a simple throttled updater for Slack messages
 * @param {Object} client - Slack client
 * @param {string} channelId - Channel ID
 * @param {string} messageTs - Message timestamp to update
 * @param {Object} options - Throttle options
 * @returns {StreamThrottle}
 */
function createSlackStreamUpdater(client, channelId, messageTs, options = {}) {
    return new StreamThrottle({
        minInterval: options.minInterval || CONSTANTS.STREAM.THROTTLE_MIN_INTERVAL_MS,
        minChars: options.minChars || CONSTANTS.STREAM.THROTTLE_MIN_CHARS,
        onFlush: async (text) => {
            await client.chat.update({
                channel: channelId,
                ts: messageTs,
                text: text + CONSTANTS.STREAM.TYPING_CURSOR
            });
        }
    });
}

module.exports = { StreamThrottle, createSlackStreamUpdater };
