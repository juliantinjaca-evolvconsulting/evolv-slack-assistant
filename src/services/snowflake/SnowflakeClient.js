/**
 * SnowflakeClient - Base client for Snowflake REST API
 * 
 * Provides common authentication, headers, and request handling
 * for all Snowflake API interactions.
 */

const DEBUG = process.env.DEBUG_CORTEX === 'true';
const CONSTANTS = require('../../config/constants');

// Default timeout for requests
const DEFAULT_TIMEOUT_MS = CONSTANTS.API.DEFAULT_TIMEOUT_MS;

class SnowflakeClient {
    /**
     * @param {Object} jwtGenerator - JWT generator instance for authentication
     * @param {Object} options - Configuration options
     * @param {string} options.baseUrl - Base URL for Snowflake API
     * @param {string} options.role - Snowflake role to use
     * @param {string} options.warehouse - Snowflake warehouse to use
     */
    constructor(jwtGenerator, options = {}) {
        this.jwtGenerator = jwtGenerator;
        this.baseUrl = options.baseUrl || this._buildBaseUrl();
        this.role = options.role || process.env.SNOWFLAKE_ROLE || 'ACCOUNTADMIN';
        this.warehouse = options.warehouse || process.env.SNOWFLAKE_WAREHOUSE || 'COMPUTE_WH';
    }

    /**
     * Build base URL from environment variables
     * @returns {string} Base URL for Snowflake API
     */
    _buildBaseUrl() {
        const account = process.env.SNOWFLAKE_ACCOUNT;
        if (!account) {
            throw new Error('SNOWFLAKE_ACCOUNT environment variable is required');
        }
        // Convert account identifier to URL format (replace _ with -)
        const accountUrl = account.toLowerCase().replace(/_/g, '-');
        return `https://${accountUrl}.snowflakecomputing.com`;
    }

    /**
     * Get common headers for Snowflake API calls
     * @param {Object} additionalHeaders - Additional headers to include
     * @returns {Object} Headers object
     */
    _getHeaders(additionalHeaders = {}) {
        return {
            'Authorization': `Bearer ${this.jwtGenerator.getToken()}`,
            'Content-Type': 'application/json',
            'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
            'X-Snowflake-Role': this.role,
            'X-Snowflake-Warehouse': this.warehouse,
            ...additionalHeaders
        };
    }

    /**
     * Make an HTTP request to Snowflake API
     * @param {string} method - HTTP method (GET, POST, DELETE, etc.)
     * @param {string} path - API path (e.g., '/api/v2/cortex/threads')
     * @param {Object} options - Request options
     * @param {Object} options.body - Request body (will be JSON stringified)
     * @param {Object} options.query - Query parameters
     * @param {Object} options.headers - Additional headers
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    async _request(method, path, options = {}) {
        const { body, query, headers: additionalHeaders } = options;
        
        // Build URL with query parameters
        let url = `${this.baseUrl}${path}`;
        if (query && Object.keys(query).length > 0) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(query)) {
                if (value !== undefined && value !== null) {
                    params.append(key, value);
                }
            }
            const queryString = params.toString();
            if (queryString) {
                url += `?${queryString}`;
            }
        }

        const headers = this._getHeaders(additionalHeaders);
        
        const fetchOptions = {
            method,
            headers
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            fetchOptions.body = JSON.stringify(body);
        }

        if (DEBUG) {
            console.log(`\n>>> [SnowflakeClient] ${method} ${url}`);
            if (body) console.log(`>>> Body:`, JSON.stringify(body, null, 2));
        }

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

        try {
            const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
            clearTimeout(timeoutId);
            
            // Handle different response types
            const contentType = response.headers.get('content-type') || '';
            let data;
            
            if (response.status === 204 || response.headers.get('content-length') === '0') {
                data = null;
            } else if (contentType.includes('application/json')) {
                // Parse JSON with large integer preservation
                const text = await response.text();
                data = this._safeJsonParse(text);
            } else {
                data = await response.text();
                // Try to parse as JSON if it looks like JSON
                if (data && (data.startsWith('{') || data.startsWith('[') || data.startsWith('"'))) {
                    try {
                        data = this._safeJsonParse(data);
                    } catch (e) {
                        // Keep as text
                    }
                }
            }

            if (DEBUG) {
                console.log(`>>> Response status: ${response.status}`);
                console.log(`>>> Response data:`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
            }

            if (!response.ok) {
                const error = new Error(`Snowflake API error: ${response.status}`);
                error.status = response.status;
                error.data = data;
                throw error;
            }

            return { ok: true, status: response.status, data };
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                const timeoutError = new Error('Request timeout - the server took too long to respond');
                timeoutError.status = 408;
                throw timeoutError;
            }
            if (error.status) {
                // Already formatted error from above
                throw error;
            }
            // Network or other error
            console.error(`[SnowflakeClient] Request failed:`, error.message);
            throw error;
        }
    }

    /**
     * Make a GET request
     * @param {string} path - API path
     * @param {Object} options - Request options (query, headers)
     * @returns {Promise<any>}
     */
    async get(path, options = {}) {
        const result = await this._request('GET', path, options);
        return result.data;
    }

    /**
     * Make a POST request
     * @param {string} path - API path
     * @param {Object} body - Request body
     * @param {Object} options - Additional options (query, headers)
     * @returns {Promise<any>}
     */
    async post(path, body = {}, options = {}) {
        const result = await this._request('POST', path, { ...options, body });
        return result.data;
    }

    /**
     * Make a PUT request
     * @param {string} path - API path
     * @param {Object} body - Request body
     * @param {Object} options - Additional options (query, headers)
     * @returns {Promise<any>}
     */
    async put(path, body = {}, options = {}) {
        const result = await this._request('PUT', path, { ...options, body });
        return result.data;
    }

    /**
     * Make a DELETE request
     * @param {string} path - API path
     * @param {Object} options - Request options (query, headers)
     * @returns {Promise<any>}
     */
    async delete(path, options = {}) {
        const result = await this._request('DELETE', path, options);
        return result.data;
    }

    /**
     * Parse JSON while preserving large integers as strings.
     * Snowflake IDs (thread_id, message_id) exceed Number.MAX_SAFE_INTEGER.
     * @param {string} text - Raw JSON string
     * @returns {any} Parsed object with large IDs as strings
     */
    _safeJsonParse(text) {
        const safed = text.replace(
            /("(?:message_id|parent_message_id|parent_id|thread_id)":\s*)(\d{16,})/g,
            '$1"$2"'
        );
        return JSON.parse(safed);
    }

    /**
     * Make a streaming POST request (SSE - Server-Sent Events)
     * Returns a readable stream of parsed SSE events.
     * 
     * @param {string} path - API path
     * @param {Object} body - Request body
     * @param {Object} options - Additional options (query, headers)
     * @returns {AsyncGenerator<{event: string, data: Object|string}>} Async generator of SSE events
     * 
     * @example
     * for await (const { event, data } of client.stream('/api/v2/.../agents/MY_AGENT:run', body)) {
     *     if (event === 'done') break;
     *     console.log(data);
     * }
     */
    async *stream(path, body = {}, options = {}) {
        const { query, headers: additionalHeaders } = options;

        let url = `${this.baseUrl}${path}`;
        if (query && Object.keys(query).length > 0) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(query)) {
                if (value !== undefined && value !== null) {
                    params.append(key, value);
                }
            }
            const queryString = params.toString();
            if (queryString) {
                url += `?${queryString}`;
            }
        }

        const headers = this._getHeaders({
            'Accept': 'text/event-stream',
            ...additionalHeaders
        });

        if (DEBUG) {
            console.log(`\n>>> [SnowflakeClient] STREAM POST ${url}`);
            if (body) console.log(`>>> Body:`, JSON.stringify(body, null, 2));
        }

        // Longer timeout for streaming connections
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS * CONSTANTS.API.STREAM_TIMEOUT_MULTIPLIER);

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal
        });

        // Clear timeout once connection is established
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            const error = new Error(`Snowflake API error: ${response.status} - ${errorText}`);
            error.status = response.status;
            throw error;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                let currentEvent = null;

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    if (trimmed.startsWith('event:')) {
                        currentEvent = trimmed.substring(6).trim();
                        if (currentEvent === 'done') {
                            yield { event: 'done', data: null };
                            return;
                        }
                        if (currentEvent === 'error') {
                            yield { event: 'error', data: null };
                            return;
                        }
                        continue;
                    }

                    if (trimmed.startsWith('data:')) {
                        const rawData = trimmed.substring(5).trim();

                        if (rawData === '[DONE]') {
                            yield { event: 'done', data: null };
                            return;
                        }

                        let parsed;
                        try {
                            parsed = this._safeJsonParse(rawData);
                        } catch (e) {
                            parsed = rawData;
                        }

                        yield { event: currentEvent || 'message', data: parsed };
                        currentEvent = null;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Execute a SQL statement via the Snowflake SQL REST API
     * @param {string} sql - SQL statement to execute
     * @param {Object} options - Execution options
     * @param {string} [options.database] - Database context
     * @param {string} [options.schema] - Schema context
     * @returns {Promise<Object>} Query result data
     */
    async executeSQL(sql, options = {}) {
        const { database, schema } = options;
        const body = {
            statement: sql,
            timeout: 60,
            warehouse: this.warehouse
        };
        if (database) body.database = database;
        if (schema) body.schema = schema;

        const result = await this._request('POST', '/api/v2/statements', { body });

        // Handle async execution (202 = still running)
        if (result.status === 202 && result.data?.statementHandle) {
            const handle = result.data.statementHandle;
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const check = await this._request('GET', `/api/v2/statements/${handle}`);
                if (check.status !== 202) return check.data;
            }
            throw new Error('SQL execution timeout');
        }

        return result.data;
    }
}

module.exports = SnowflakeClient;
