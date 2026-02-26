/**
 * ThreadsAPI - Snowflake Cortex Agents Threads REST API Client
 * 
 * Full implementation of the Threads API for managing conversation threads.
 * @see https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-threads-rest-api
 */

const SnowflakeClient = require('./SnowflakeClient');

const THREADS_BASE_PATH = '/api/v2/cortex/threads';

class ThreadsAPI extends SnowflakeClient {
    static namespace = 'threads';
    /**
     * Create a new thread
     * 
     * @param {string} originApplication - Application identifier (max 16 bytes). 
     *                                     Allows grouping threads by application.
     * @returns {Promise<number>} Thread UUID as integer
     * 
     * @example
     * const threadId = await threadsAPI.create('slack_bot');
     * // Returns: 1234567890
     */
    async create(originApplication = 'slack_bot') {
        const body = {};
        if (originApplication) {
            // Ensure origin_application is max 16 bytes
            body.origin_application = originApplication.substring(0, 16);
        }

        const data = await this.post(THREADS_BASE_PATH, body);
        
        // API returns an object: { thread_id, thread_name, origin_application, created_on, updated_on }
        // thread_id is preserved as a string by _safeJsonParse to avoid BigInt precision loss
        if (data && typeof data === 'object' && data.thread_id !== undefined) {
            return data.thread_id;
        }
        return data;
    }

    /**
     * Describe a thread and retrieve its messages
     * 
     * Returns thread metadata and a batch of messages in descending order of creation.
     * Use pagination parameters to retrieve messages in batches.
     * 
     * @param {number|string} threadId - Thread UUID
     * @param {Object} options - Pagination options
     * @param {number} options.pageSize - Number of messages to return (default: 20, max: 100)
     * @param {number} options.lastMessageId - ID of last message received (for pagination offset)
     * @returns {Promise<ThreadDescription>} Thread metadata and messages
     * 
     * @typedef {Object} ThreadDescription
     * @property {ThreadMetadata} metadata - Thread metadata
     * @property {Message[]} messages - Array of messages
     * 
     * @typedef {Object} ThreadMetadata
     * @property {number} thread_id - Thread UUID
     * @property {string} thread_name - Name of the thread
     * @property {string} origin_application - Application that created the thread
     * @property {number} created_on - Creation timestamp (ms since epoch)
     * @property {number} updated_on - Last update timestamp (ms since epoch)
     * 
     * @typedef {Object} Message
     * @property {number} message_id - Message UUID
     * @property {number|null} parent_id - Parent message UUID
     * @property {number} created_on - Creation timestamp (ms since epoch)
     * @property {string} role - Role that generated the message ('user' | 'assistant')
     * @property {string} message_payload - Message content
     * @property {string} request_id - Original request ID
     * 
     * @example
     * // Get first batch of messages
     * const { metadata, messages } = await threadsAPI.describe(threadId);
     * 
     * // Get next batch using pagination
     * const lastId = messages[messages.length - 1].message_id;
     * const nextBatch = await threadsAPI.describe(threadId, { lastMessageId: lastId });
     */
    async describe(threadId, options = {}) {
        const { pageSize, lastMessageId } = options;
        
        const query = {};
        if (pageSize !== undefined) {
            query.page_size = Math.min(Math.max(1, pageSize), 100); // Clamp to 1-100
        }
        if (lastMessageId !== undefined) {
            query.last_message_id = lastMessageId;
        }

        return await this.get(`${THREADS_BASE_PATH}/${threadId}`, { query });
    }

    /**
     * Update a thread's name
     * 
     * @param {number|string} threadId - Thread UUID
     * @param {string} threadName - New name for the thread
     * @returns {Promise<{status: string}>} Status message
     * 
     * @example
     * await threadsAPI.update(threadId, 'Sales Pipeline Discussion');
     * // Returns: { status: 'Thread xxxx successfully updated.' }
     */
    async update(threadId, threadName) {
        if (!threadName || typeof threadName !== 'string') {
            throw new Error('threadName is required and must be a string');
        }

        return await this.post(`${THREADS_BASE_PATH}/${threadId}`, {
            thread_name: threadName
        });
    }

    /**
     * List all threads belonging to the authenticated user
     * 
     * @param {string} originApplication - Optional filter by application name
     * @returns {Promise<ThreadMetadata[]>} Array of thread metadata objects
     * 
     * @example
     * // List all threads
     * const allThreads = await threadsAPI.list();
     * 
     * // List only threads from a specific application
     * const slackThreads = await threadsAPI.list('slack_bot');
     */
    async list(originApplication = null) {
        const query = {};
        if (originApplication) {
            query.origin_application = originApplication;
        }

        return await this.get(THREADS_BASE_PATH, { query });
    }

    /**
     * Delete a thread and all its messages
     * 
     * @param {number|string} threadId - Thread UUID
     * @returns {Promise<{success: boolean}>} Success response
     * 
     * @example
     * await threadsAPI.delete(threadId);
     * // Returns: { success: true }
     */
    async delete(threadId) {
        return await super.delete(`${THREADS_BASE_PATH}/${threadId}`);
    }

    // ==================== Convenience Methods ====================

    /**
     * Get all messages from a thread (handles pagination automatically)
     * 
     * @param {number|string} threadId - Thread UUID
     * @param {number} maxMessages - Maximum messages to retrieve (default: 1000)
     * @returns {Promise<{metadata: ThreadMetadata, messages: Message[]}>}
     * 
     * @example
     * const { metadata, messages } = await threadsAPI.getAllMessages(threadId);
     */
    async getAllMessages(threadId, maxMessages = 1000) {
        let allMessages = [];
        let lastMessageId = null;
        let metadata = null;

        while (allMessages.length < maxMessages) {
            const options = { pageSize: 100 };
            if (lastMessageId) {
                options.lastMessageId = lastMessageId;
            }

            const result = await this.describe(threadId, options);
            
            if (!metadata) {
                metadata = result.metadata;
            }

            if (!result.messages || result.messages.length === 0) {
                break;
            }

            allMessages = allMessages.concat(result.messages);
            lastMessageId = result.messages[result.messages.length - 1].message_id;

            // If we got fewer than requested, we've reached the end
            if (result.messages.length < 100) {
                break;
            }
        }

        return { metadata, messages: allMessages.slice(0, maxMessages) };
    }

    /**
     * Check if a thread exists and belongs to the user
     * 
     * @param {number|string} threadId - Thread UUID
     * @returns {Promise<boolean>} True if thread exists and is accessible
     */
    async exists(threadId) {
        try {
            await this.describe(threadId, { pageSize: 1 });
            return true;
        } catch (error) {
            if (error.status === 404 || error.status === 403) {
                return false;
            }
            throw error;
        }
    }
}

module.exports = ThreadsAPI;
