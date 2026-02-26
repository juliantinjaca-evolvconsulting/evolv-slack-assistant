/**
 * CortexChat - Snowflake Cortex Agent Client
 * 
 * Handles communication with Snowflake Cortex Agents via REST API.
 * Uses SSE (Server-Sent Events) streaming for responses.
 * Uses native Snowflake Threads for conversation context management.
 * 
 * Delegates all Snowflake API calls to CortexAPI (ThreadsAPI, AgentsAPI).
 */

const { performance } = require('perf_hooks');

const DEBUG_CORTEX = process.env.DEBUG_CORTEX === 'true';

// Thread TTL: 7 days in milliseconds
const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Snowflake table for thread persistence
const THREAD_TABLE = process.env.THREAD_MAPPINGS_TABLE || 
    `${process.env.SNOWFLAKE_DATABASE}.${process.env.SNOWFLAKE_SCHEMA}.SLACK_THREAD_MAPPINGS`;

/**
 * Thread store with Snowflake persistence - maps Slack thread_ts to Snowflake thread data
 * Uses in-memory cache with async sync to Snowflake
 */
class ThreadStore {
    constructor(api) {
        this.api = api;
        this.threads = new Map();
        this.userThreads = new Map(); // userId -> slackThreadId
        this.initialized = false;
    }

    /**
     * Initialize store by loading from Snowflake
     */
    async initialize() {
        if (this.initialized) return;
        await this._loadFromSnowflake();
        this.initialized = true;
    }

    /**
     * Get thread data for a Slack conversation
     */
    get(slackThreadId) {
        return this.threads.get(slackThreadId) || null;
    }

    /**
     * Set thread data for a Slack conversation
     * @param {string} slackThreadId - Slack thread_ts
     * @param {string} threadId - Snowflake thread ID
     * @param {number} lastMessageId - Last message ID
     * @param {string|null} userId - Slack user ID who owns this thread
     */
    async set(slackThreadId, threadId, lastMessageId = 0, userId = null) {
        const now = Date.now();
        this.threads.set(slackThreadId, { 
            threadId, 
            lastMessageId,
            createdAt: now
        });
        if (userId) {
            this.userThreads.set(userId, slackThreadId);
        }
        await this._upsertThread(slackThreadId, threadId, lastMessageId, userId, now);
    }

    /**
     * Update the last message ID for an existing thread
     */
    async updateLastMessageId(slackThreadId, lastMessageId) {
        const data = this.threads.get(slackThreadId);
        if (data) {
            data.lastMessageId = lastMessageId;
            await this._updateLastMessageId(slackThreadId, lastMessageId);
        }
    }

    /**
     * Delete a thread mapping
     */
    async delete(slackThreadId) {
        this.threads.delete(slackThreadId);
        await this._deleteThread(slackThreadId);
    }

    /**
     * Get the latest Slack thread ID for a user
     */
    getUserThread(userId) {
        return this.userThreads.get(userId) || null;
    }

    /**
     * Track the latest Slack thread for a user
     */
    async setUserThread(userId, slackThreadId) {
        this.userThreads.set(userId, slackThreadId);
        await this._updateUserThread(slackThreadId, userId);
    }

    /**
     * Load thread mappings from Snowflake
     */
    async _loadFromSnowflake() {
        try {
            const sql = `SELECT SLACK_THREAD_ID, SNOWFLAKE_THREAD_ID, LAST_MESSAGE_ID, USER_ID, CREATED_AT 
                         FROM ${THREAD_TABLE} 
                         WHERE CREATED_AT > DATEADD(day, -7, CURRENT_TIMESTAMP())`;
            
            const result = await this.api.agents.executeSQL(sql);
            
            if (result?.data) {
                for (const row of result.data) {
                    const [slackThreadId, snowflakeThreadId, lastMessageId, userId, createdAt] = row;
                    this.threads.set(slackThreadId, {
                        threadId: snowflakeThreadId,
                        lastMessageId: lastMessageId || 0,
                        createdAt: new Date(createdAt).getTime()
                    });
                    if (userId) {
                        this.userThreads.set(userId, slackThreadId);
                    }
                }
                console.log(`[ThreadStore] Loaded ${this.threads.size} thread mappings from Snowflake`);
            }
        } catch (error) {
            console.error('[ThreadStore] Error loading from Snowflake:', error.message);
        }
    }

    /**
     * Insert or update a thread in Snowflake
     */
    async _upsertThread(slackThreadId, snowflakeThreadId, lastMessageId, userId, createdAt) {
        try {
            const sql = `MERGE INTO ${THREAD_TABLE} t
                USING (SELECT '${slackThreadId}' AS SLACK_THREAD_ID) s
                ON t.SLACK_THREAD_ID = s.SLACK_THREAD_ID
                WHEN MATCHED THEN UPDATE SET 
                    SNOWFLAKE_THREAD_ID = '${snowflakeThreadId}',
                    LAST_MESSAGE_ID = ${lastMessageId},
                    USER_ID = COALESCE(${userId ? `'${userId}'` : 'NULL'}, t.USER_ID),
                    UPDATED_AT = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT (SLACK_THREAD_ID, SNOWFLAKE_THREAD_ID, LAST_MESSAGE_ID, USER_ID, CREATED_AT)
                    VALUES ('${slackThreadId}', '${snowflakeThreadId}', ${lastMessageId}, ${userId ? `'${userId}'` : 'NULL'}, TO_TIMESTAMP_NTZ(${createdAt}, 3))`;
            
            await this.api.agents.executeSQL(sql);
        } catch (error) {
            console.error('[ThreadStore] Error upserting thread:', error.message);
        }
    }

    /**
     * Update last message ID in Snowflake
     */
    async _updateLastMessageId(slackThreadId, lastMessageId) {
        try {
            const sql = `UPDATE ${THREAD_TABLE} 
                         SET LAST_MESSAGE_ID = ${lastMessageId}, UPDATED_AT = CURRENT_TIMESTAMP() 
                         WHERE SLACK_THREAD_ID = '${slackThreadId}'`;
            await this.api.agents.executeSQL(sql);
        } catch (error) {
            console.error('[ThreadStore] Error updating lastMessageId:', error.message);
        }
    }

    /**
     * Update user thread mapping in Snowflake
     */
    async _updateUserThread(slackThreadId, userId) {
        try {
            const sql = `UPDATE ${THREAD_TABLE} 
                         SET USER_ID = '${userId}', UPDATED_AT = CURRENT_TIMESTAMP() 
                         WHERE SLACK_THREAD_ID = '${slackThreadId}'`;
            await this.api.agents.executeSQL(sql);
        } catch (error) {
            console.error('[ThreadStore] Error updating user thread:', error.message);
        }
    }

    /**
     * Delete thread from Snowflake
     */
    async _deleteThread(slackThreadId) {
        try {
            const sql = `DELETE FROM ${THREAD_TABLE} WHERE SLACK_THREAD_ID = '${slackThreadId}'`;
            await this.api.agents.executeSQL(sql);
        } catch (error) {
            console.error('[ThreadStore] Error deleting thread:', error.message);
        }
    }
}

/**
 * Parse a Cortex Agent endpoint URL to extract database, schema, and agent name.
 * Expected format: .../api/v2/databases/{db}/schemas/{schema}/agents/{name}:run
 * 
 * @param {string} endpoint - Full agent endpoint URL
 * @returns {{ database: string, schema: string, agentName: string }}
 */
function parseAgentEndpoint(endpoint) {
    const match = endpoint.match(
        /\/api\/v2\/databases\/([^/]+)\/schemas\/([^/]+)\/agents\/([^/:]+)/
    );
    if (!match) {
        throw new Error(`Invalid agent endpoint format: ${endpoint}`);
    }
    return {
        database: decodeURIComponent(match[1]),
        schema: decodeURIComponent(match[2]),
        agentName: decodeURIComponent(match[3])
    };
}

class CortexChat {
    /**
     * @param {import('./snowflake/CortexAPI')} api - CortexAPI instance
     */
    constructor(api) {
        this.api = api;
        this.threadStore = new ThreadStore(api);

        // Parse agent endpoint to extract database, schema, agent name
        const endpoint = process.env.CORTEX_AGENT_ENDPOINT;
        const { database, schema, agentName } = parseAgentEndpoint(endpoint);
        this.database = database;
        this.schema = schema;
        this.agentName = agentName;

        if (DEBUG_CORTEX) {
            console.log(`CortexChat initialized: ${database}.${schema}.${agentName}`);
        }
    }

    /**
     * Initialize the thread store (load from Snowflake)
     * Must be called before using the chat
     */
    async initialize() {
        await this.threadStore.initialize();
    }

    /**
     * Get or create a Snowflake thread for a Slack conversation
     * @param {string} slackThreadId - Slack thread_ts
     * @param {string|null} userId - Slack user ID who owns this thread
     * @returns {Promise<{ threadId: string, lastMessageId: number }>}
     */
    async _getOrCreateThread(slackThreadId, userId = null) {
        let threadData = this.threadStore.get(slackThreadId);
        
        if (!threadData) {
            // Create new thread with userId
            const threadId = await this.api.threads.create('slack_bot');
            threadData = { threadId, lastMessageId: 0 };
            await this.threadStore.set(slackThreadId, threadId, 0, userId);
        } else if (userId) {
            // Thread exists - ensure userId is set (for threads created before this fix)
            await this.threadStore.setUserThread(userId, slackThreadId);
        }
        
        return threadData;
    }

    /**
     * Send a query to the Cortex Agent with streaming token callback
     * Emits text tokens as they arrive for real-time display
     * @param {string} query - The user's question
     * @param {string} slackThreadId - Slack thread_ts for conversation tracking
     * @param {string|null} userId - Slack user ID who owns this thread
     * @param {Function} onToken - Callback for each text token: (token: string) => Promise<void>
     * @param {Function} onStatus - Callback for status updates: (status: string) => Promise<void>
     * @param {Function} onThinking - Callback for thinking tokens: (token: string) => Promise<void>
     * @returns {Promise<{text: string, sql: string, resultSet: object, chart: object}>}
     */
    async sendMessageStreaming(query, slackThreadId = 'default', userId = null, onToken = null, onStatus = null, onThinking = null) {
        try {
            const totalStart = performance.now();

            // Get or create Snowflake thread
            const threadStart = performance.now();
            const { threadId, lastMessageId } = await this._getOrCreateThread(slackThreadId, userId);
            const threadMs = (performance.now() - threadStart).toFixed(0);

            // Build request body with thread context
            const body = {
                thread_id: threadId,
                parent_message_id: lastMessageId,
                messages: [
                    {
                        role: 'user',
                        content: [{ type: 'text', text: query }]
                    }
                ],
                tool_choice: { type: 'auto' }
            };

            if (DEBUG_CORTEX) {
                console.log(`\n>>> Sending streaming message to Cortex Agent`);
                console.log(`>>> Thread ID: ${threadId}`);
                console.log(`>>> Query: ${query.substring(0, 50)}...`);
            }

            // Stream response from agent with token callback
            const streamStart = performance.now();
            const result = await this._consumeAgentStreamWithCallback(
                this.api.agents.run(this.database, this.schema, this.agentName, body),
                onToken,
                onStatus,
                onThinking
            );
            const streamMs = (performance.now() - streamStart).toFixed(0);

            // Update last message ID if we got an assistant message
            if (result.assistantMessageId) {
                await this.threadStore.updateLastMessageId(slackThreadId, result.assistantMessageId);
            }

            const totalMs = (performance.now() - totalStart).toFixed(0);
            console.log(`[Cortex Streaming] thread=${threadMs}ms | stream=${streamMs}ms | total=${totalMs}ms`);

            return result;
        } catch (error) {
            console.error('Error in streaming response:', error);
            return { text: 'An error occurred while processing your request. Please try again.', sql: '', resultSet: null };
        }
    }

    /**
     * Send a query to the Cortex Agent and retrieve the response
     * Uses native Snowflake threads for conversation context
     * @param {string} query - The user's question
     * @param {string} slackThreadId - Slack thread_ts for conversation tracking
     * @param {string|null} userId - Slack user ID who owns this thread
     * @returns {Promise<{text: string, sql: string, resultSet: object, chart: object}>}
     */
    async sendMessage(query, slackThreadId = 'default', userId = null) {
        try {
            const totalStart = performance.now();

            // Get or create Snowflake thread
            const threadStart = performance.now();
            const { threadId, lastMessageId } = await this._getOrCreateThread(slackThreadId, userId);
            const threadMs = (performance.now() - threadStart).toFixed(0);

            // Build request body with thread context
            const body = {
                thread_id: threadId,
                parent_message_id: lastMessageId,
                messages: [
                    {
                        role: 'user',
                        content: [{ type: 'text', text: query }]
                    }
                ],
                tool_choice: { type: 'auto' }
            };

            if (DEBUG_CORTEX) {
                console.log(`\n>>> Sending message to Cortex Agent`);
                console.log(`>>> Thread ID: ${threadId} (type: ${typeof threadId})`);
                console.log(`>>> Parent Message ID: ${lastMessageId} (type: ${typeof lastMessageId})`);
                console.log(`>>> Query: ${query.substring(0, 50)}...`);
            }

            // Stream response from agent via AgentsAPI
            const streamStart = performance.now();
            const result = await this._consumeAgentStream(
                this.api.agents.run(this.database, this.schema, this.agentName, body)
            );
            const streamMs = (performance.now() - streamStart).toFixed(0);
            
            // Update last message ID if we got an assistant message
            if (result.assistantMessageId) {
                await this.threadStore.updateLastMessageId(slackThreadId, result.assistantMessageId);
                if (DEBUG_CORTEX) console.log(`>>> Updated last message ID to: ${result.assistantMessageId}`);
            }

            const totalMs = (performance.now() - totalStart).toFixed(0);
            console.log(`[Cortex] thread=${threadMs}ms | stream=${streamMs}ms (first-byte=${result._timing?.firstByteMs || '?'}ms, events=${result._timing?.eventCount || '?'}) | total=${totalMs}ms`);

            return result;
        } catch (error) {
            console.error('Error fetching response:', error);
            return { text: `Error: ${error.message}`, sql: '', resultSet: null };
        }
    }

    /**
     * Clear thread mapping (deletes local reference, not Snowflake thread)
     * @param {string} slackThreadId - Slack thread_ts to clear
     */
    async clearHistory(slackThreadId) {
        await this.threadStore.delete(slackThreadId);
    }

    /**
     * Reset the Snowflake thread for a user (called on "New Chat").
     * Deletes the old Snowflake thread and clears the local mapping
     * so the next message creates a fresh thread.
     * @param {string} userId - Slack user ID
     * @param {string} newSlackThreadId - The new Slack thread_ts to track
     */
    async resetForUser(userId, newSlackThreadId) {
        const previousSlackThread = this.threadStore.getUserThread(userId);

        if (previousSlackThread) {
            // Delete old Snowflake thread if it exists
            const threadData = this.threadStore.get(previousSlackThread);
            if (threadData) {
                try {
                    await this.api.threads.delete(threadData.threadId);
                    if (DEBUG_CORTEX) console.log(`>>> Deleted old Snowflake thread: ${threadData.threadId} for user ${userId}`);
                } catch (error) {
                    // Non-critical: log and continue even if Snowflake deletion fails
                    console.error(`Error deleting old Snowflake thread for user ${userId}:`, error.message);
                }
                await this.threadStore.delete(previousSlackThread);
            }
        }

        // Track the new thread as the user's latest
        await this.threadStore.setUserThread(userId, newSlackThreadId);
    }

    /**
     * Delete a thread from Snowflake
     * @param {string} slackThreadId - Slack thread_ts
     */
    async deleteThread(slackThreadId) {
        const threadData = this.threadStore.get(slackThreadId);
        if (!threadData) return;

        try {
            await this.api.threads.delete(threadData.threadId);
            await this.threadStore.delete(slackThreadId);
            if (DEBUG_CORTEX) console.log(`>>> Deleted thread: ${threadData.threadId}`);
        } catch (error) {
            console.error('Error deleting thread:', error.message);
        }
    }

    /**
     * Consume the SSE stream from AgentsAPI.run() and accumulate results
     * @param {AsyncGenerator<{event: string, data: Object|string}>} stream - SSE event stream
     * @returns {Promise<{text: string, sql: string, resultSet: object, chart: object, assistantMessageId: number}>}
     */
    async _consumeAgentStream(stream) {
        const streamStart = performance.now();
        let firstByteMs = null;
        let eventCount = 0;

        const accumulated = {
            text: '',
            sql: '',
            resultSet: null,
            chart: null,
            tableTitle: null,
            userMessageId: null,
            assistantMessageId: null,
            events: []
        };

        for await (const { event, data } of stream) {
            if (firstByteMs === null) {
                firstByteMs = (performance.now() - streamStart).toFixed(0);
            }
            eventCount++;

            if (event === 'done' || event === 'error') break;
            if (!data || typeof data !== 'object') continue;

            accumulated.events.push(data);
            this._processEvent(data, accumulated);
        }

        if (DEBUG_CORTEX) {
            console.log('\n========== DEBUG: FULL RESPONSE ==========');
            console.log('>>> text:', accumulated.text ? accumulated.text.substring(0, 100) + '...' : 'NULL');
            console.log('>>> sql:', accumulated.sql ? 'YES' : 'NULL');
            console.log('>>> resultSet:', accumulated.resultSet ? `YES (${accumulated.resultSet.data?.length || 0} rows)` : 'NULL');
            console.log('>>> chart:', accumulated.chart ? 'YES' : 'NULL');
            console.log('>>> userMessageId:', accumulated.userMessageId);
            console.log('>>> assistantMessageId:', accumulated.assistantMessageId);
            console.log('==========================================\n');
        }

        return {
            text: accumulated.text || 'No response from agent.',
            sql: accumulated.sql,
            resultSet: accumulated.resultSet,
            chart: accumulated.chart,
            tableTitle: accumulated.tableTitle,
            assistantMessageId: accumulated.assistantMessageId,
            _timing: { firstByteMs, eventCount }
        };
    }

    /**
     * Consume the SSE stream with token callback for real-time streaming
     * @param {AsyncGenerator<{event: string, data: Object|string}>} stream - SSE event stream
     * @param {Function} onToken - Callback for text tokens: (token: string) => Promise<void>
     * @param {Function} onStatus - Callback for status updates: (status: string) => Promise<void>
     * @param {Function} onThinking - Callback for thinking tokens: (token: string) => Promise<void>
     * @returns {Promise<{text: string, sql: string, resultSet: object, chart: object, assistantMessageId: number}>}
     */
    async _consumeAgentStreamWithCallback(stream, onToken, onStatus, onThinking) {
        const streamStart = performance.now();
        let firstByteMs = null;
        let eventCount = 0;

        const accumulated = {
            text: '',
            sql: '',
            resultSet: null,
            chart: null,
            tableTitle: null,
            userMessageId: null,
            assistantMessageId: null,
            events: []
        };

        for await (const { event, data } of stream) {
            if (firstByteMs === null) {
                firstByteMs = (performance.now() - streamStart).toFixed(0);
            }
            eventCount++;

            if (event === 'done' || event === 'error') break;
            if (!data || typeof data !== 'object') continue;

            accumulated.events.push(data);

            // Debug: log event structure to understand format
            if (DEBUG_CORTEX) {
                console.log(`>>> Event ${eventCount} [${event}]:`, JSON.stringify(data).substring(0, 200));
            }

            // Handle status events - update Slack typing indicator
            if (onStatus && event === 'response.status' && data.message) {
                try {
                    await onStatus(data.message);
                } catch (e) {
                    if (DEBUG_CORTEX) console.error('Status callback error:', e.message);
                }
            }

            // Handle thinking events - show reasoning in Slack
            if (onThinking && event === 'response.thinking' && data.text) {
                try {
                    const cleanText = data.text.trim().replace(/^_+|_+$/g, '').trim();
                    if (cleanText) {
                        await onThinking(cleanText);
                    }
                } catch (e) {
                    if (DEBUG_CORTEX) console.error('Thinking callback error:', e.message);
                }
            }

            // Extract and emit streaming text deltas
            if (onToken) {
                const delta = this._extractTextDelta(event, data);
                if (delta) {
                    accumulated.text += delta;
                    try {
                        await onToken(delta);
                    } catch (e) {
                        // Don't break stream on callback error
                        if (DEBUG_CORTEX) console.error('Token callback error:', e.message);
                    }
                }
            }

            // Process full event for non-text data (charts, tables, etc.)
            this._processEventNonText(data, accumulated);
        }

        if (DEBUG_CORTEX) {
            console.log('\n========== DEBUG: STREAMING RESPONSE ==========');
            console.log('>>> text length:', accumulated.text?.length || 0);
            console.log('>>> resultSet:', accumulated.resultSet ? `YES (${accumulated.resultSet.data?.length || 0} rows)` : 'NULL');
            console.log('>>> chart:', accumulated.chart ? 'YES' : 'NULL');
            console.log('===============================================\n');
        }

        return {
            text: accumulated.text || 'No response from agent.',
            sql: accumulated.sql,
            resultSet: accumulated.resultSet,
            chart: accumulated.chart,
            tableTitle: accumulated.tableTitle,
            assistantMessageId: accumulated.assistantMessageId,
            _timing: { firstByteMs, eventCount }
        };
    }

    /**
     * Extract text delta from SSE event for streaming
     * Cortex streams: response.text.delta with {content_index, text}
     * @param {string} eventType - SSE event type (e.g., 'response.text.delta')
     * @param {Object} data - Parsed JSON data
     * @returns {string|null} Text delta or null
     */
    _extractTextDelta(eventType, data) {
        // Cortex Agents: response.text.delta events contain answer tokens
        if (eventType === 'response.text.delta' && data.text) {
            return data.text;
        }

        // Cortex Agents: response.thinking.delta events contain reasoning tokens
        // (optional - can show "thinking" to user)
        // if (eventType === 'response.thinking.delta' && data.text) {
        //     return data.text;
        // }

        // Handle delta.text format (other providers)
        if (data.delta?.text) {
            return data.delta.text;
        }
        
        // Handle content_block_delta events
        if (data.type === 'content_block_delta' && data.delta?.text) {
            return data.delta.text;
        }

        return null;
    }

    /**
     * Extract text from Cortex content array
     * @param {Array} content - Content array
     * @returns {string|null} Extracted text or null
     */
    _extractTextFromContent(content) {
        if (!Array.isArray(content)) return null;

        for (const item of content) {
            // Direct json content with text
            if (item.type === 'json' && item.json?.text) {
                return item.json.text;
            }

            // Direct text content
            if (item.type === 'text' && item.text) {
                return item.text;
            }

            // Nested tool_result content
            if (item.type === 'tool_result' && item.tool_result?.content) {
                for (const nestedItem of item.tool_result.content) {
                    if (nestedItem.type === 'json' && nestedItem.json?.text) {
                        return nestedItem.json.text;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Process SSE event for non-text data (metadata, charts, tables)
     * @param {Object} event - Parsed JSON event
     * @param {Object} accumulated - Accumulated response data
     */
    _processEventNonText(event, accumulated) {
        // Handle metadata events (message IDs)
        const meta = event.metadata || event;
        if (meta.role && meta.message_id !== undefined) {
            if (meta.role === 'user') {
                accumulated.userMessageId = meta.message_id;
            } else if (meta.role === 'assistant') {
                accumulated.assistantMessageId = meta.message_id;
            }
        }

        // Handle error events
        if (event.message && event.code) {
            console.error(`Agent error: ${event.message} (code: ${event.code})`);
            return;
        }

        // Handle chart events
        if (event.chart_spec && !accumulated.chart) {
            try {
                accumulated.chart = {
                    spec: typeof event.chart_spec === 'string' ? JSON.parse(event.chart_spec) : event.chart_spec,
                    toolUseId: event.tool_use_id,
                    contentIndex: event.content_index
                };
            } catch (e) {
                console.error('Error parsing chart_spec:', e);
            }
        }

        // Handle tool result events (SQL, result sets)
        if (event.type === 'cortex_analyst_text_to_sql' && event.content) {
            this._extractFromContentNonText(event.content, accumulated);
        }

        // Handle final response with tables
        if (event.role === 'assistant' && event.content) {
            this._extractFromContentNonText(event.content, accumulated);
        }
    }

    /**
     * Extract SQL and results from content (excludes text for streaming)
     * @param {Array} content - Content array from event
     * @param {Object} accumulated - Accumulated response data
     */
    _extractFromContentNonText(content, accumulated) {
        if (!Array.isArray(content)) return;

        for (const item of content) {
            // Direct json content
            if (item.type === 'json' && item.json) {
                if (item.json.sql) accumulated.sql = item.json.sql;
                if (item.json.result_set) accumulated.resultSet = item.json.result_set;
            }

            // Nested tool_result content
            if (item.type === 'tool_result' && item.tool_result?.content) {
                for (const nestedItem of item.tool_result.content) {
                    if (nestedItem.type === 'json' && nestedItem.json) {
                        if (nestedItem.json.sql) accumulated.sql = nestedItem.json.sql;
                        if (nestedItem.json.result_set) accumulated.resultSet = nestedItem.json.result_set;
                    }
                }
            }

            // Handle table type content
            if (item.type === 'table' && item.table?.result_set) {
                accumulated.resultSet = item.table.result_set;
                accumulated.tableTitle = item.table.title;
            }
        }
    }

    /**
     * Process individual SSE event and extract relevant data
     * @param {Object} event - Parsed JSON event
     * @param {Object} accumulated - Accumulated response data
     */
    _processEvent(event, accumulated) {
        // Handle metadata events (message IDs from thread)
        // SSE metadata events arrive as: { metadata: { message_id, role } }
        const meta = event.metadata || event;
        if (meta.role && meta.message_id !== undefined) {
            if (meta.role === 'user') {
                accumulated.userMessageId = meta.message_id;
                if (DEBUG_CORTEX) console.log(`>>> User message ID: ${meta.message_id}`);
            } else if (meta.role === 'assistant') {
                accumulated.assistantMessageId = meta.message_id;
                if (DEBUG_CORTEX) console.log(`>>> Assistant message ID: ${meta.message_id}`);
            }
        }

        // Handle error events
        if (event.message && event.code) {
            console.error(`Agent error: ${event.message} (code: ${event.code})`);
            accumulated.text = `Error: ${event.message}`;
            return;
        }

        // Handle chart events
        if (event.chart_spec && !accumulated.chart) {
            try {
                accumulated.chart = {
                    spec: typeof event.chart_spec === 'string' ? JSON.parse(event.chart_spec) : event.chart_spec,
                    toolUseId: event.tool_use_id,
                    contentIndex: event.content_index
                };
                if (DEBUG_CORTEX) console.log('>>> Chart captured from SSE event');
            } catch (e) {
                console.error('Error parsing chart_spec:', e);
            }
        }

        // Handle tool result events
        if (event.type === 'cortex_analyst_text_to_sql' && event.content) {
            this._extractFromContent(event.content, accumulated);
        }

        // Handle final response event
        if (event.role === 'assistant' && event.content) {
            this._extractFromContent(event.content, accumulated);
        }
    }

    /**
     * Extract SQL, text, and results from content array
     * @param {Array} content - Content array from event
     * @param {Object} accumulated - Accumulated response data
     */
    _extractFromContent(content, accumulated) {
        if (!Array.isArray(content)) return;

        for (const item of content) {
            // Direct json content
            if (item.type === 'json' && item.json) {
                if (item.json.sql) accumulated.sql = item.json.sql;
                if (item.json.text) accumulated.text = item.json.text;
                if (item.json.result_set) accumulated.resultSet = item.json.result_set;
            }

            // Nested tool_result content
            if (item.type === 'tool_result' && item.tool_result?.content) {
                for (const nestedItem of item.tool_result.content) {
                    if (nestedItem.type === 'json' && nestedItem.json) {
                        if (nestedItem.json.sql) accumulated.sql = nestedItem.json.sql;
                        if (nestedItem.json.text) accumulated.text = nestedItem.json.text;
                        if (nestedItem.json.result_set) accumulated.resultSet = nestedItem.json.result_set;
                    }
                }
            }

            // Handle table type content
            if (item.type === 'table' && item.table?.result_set) {
                accumulated.resultSet = item.table.result_set;
                accumulated.tableTitle = item.table.title;
                if (DEBUG_CORTEX) console.log('>>> Table captured from response');
            }

            // Direct text content
            if (item.type === 'text' && item.text) {
                accumulated.text = item.text;
            }
        }
    }
}

module.exports = CortexChat;
