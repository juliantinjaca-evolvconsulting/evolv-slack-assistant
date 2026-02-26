/**
 * AgentsAPI - Snowflake Cortex Agents REST API Client
 * 
 * Full implementation of the Cortex Agents API for creating, managing,
 * and running Cortex Agent Objects.
 * @see https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-rest-api
 */

const SnowflakeClient = require('./SnowflakeClient');

class AgentsAPI extends SnowflakeClient {
    static namespace = 'agents';

    /**
     * Build the base path for agents in a given database/schema
     * @param {string} database - Database identifier
     * @param {string} schema - Schema identifier
     * @returns {string} Base API path
     */
    _basePath(database, schema) {
        return `/api/v2/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(schema)}/agents`;
    }

    /**
     * Create a new Cortex Agent
     * 
     * @param {string} database - Database identifier
     * @param {string} schema - Schema identifier
     * @param {Object} spec - Agent specification
     * @param {string} spec.name - Name of the agent
     * @param {string} [spec.comment] - Optional comment
     * @param {Object} [spec.profile] - Agent profile (display_name, avatar, color)
     * @param {Object} [spec.models] - Model configuration (e.g., { orchestration: 'claude-4-sonnet' })
     * @param {Object} [spec.instructions] - Agent instructions (response, orchestration, system, sample_questions)
     * @param {Object} [spec.orchestration] - Orchestration config (budget: { seconds, tokens })
     * @param {Array} [spec.tools] - Tools available to the agent
     * @param {Object} [spec.tool_resources] - Configuration for each tool
     * @param {Object} [options] - Additional options
     * @param {string} [options.createMode] - 'errorIfExists' | 'orReplace' | 'ifNotExists'
     * @returns {Promise<{status: string}>} Creation status
     * 
     * @example
     * await agentsAPI.create('MY_DB', 'MY_SCHEMA', {
     *     name: 'MY_AGENT',
     *     models: { orchestration: 'claude-4-sonnet' },
     *     tools: [{ tool_spec: { type: 'cortex_analyst_text_to_sql', name: 'analyst' } }],
     *     tool_resources: { analyst: { semantic_model_file: '@stage/model.yaml' } }
     * });
     */
    async create(database, schema, spec, options = {}) {
        const query = {};
        if (options.createMode) {
            query.createMode = options.createMode;
        }

        return await this.post(this._basePath(database, schema), spec, { query });
    }

    /**
     * Describe a Cortex Agent
     * 
     * @param {string} database - Database identifier
     * @param {string} schema - Schema identifier
     * @param {string} name - Agent name
     * @returns {Promise<Object>} Agent details including agent_spec, name, database_name, schema_name, owner, created_on
     * 
     * @example
     * const agent = await agentsAPI.describe('MY_DB', 'MY_SCHEMA', 'MY_AGENT');
     * console.log(agent.agent_spec);
     */
    async describe(database, schema, name) {
        return await this.get(`${this._basePath(database, schema)}/${encodeURIComponent(name)}`);
    }

    /**
     * Update an existing Cortex Agent
     * 
     * @param {string} database - Database identifier
     * @param {string} schema - Schema identifier
     * @param {string} name - Agent name
     * @param {Object} spec - Updated agent specification (same fields as create, minus name)
     * @returns {Promise<{status: string}>} Update status
     * 
     * @example
     * await agentsAPI.update('MY_DB', 'MY_SCHEMA', 'MY_AGENT', {
     *     instructions: { response: 'Be concise and helpful' }
     * });
     */
    async update(database, schema, name, spec) {
        return await this.put(`${this._basePath(database, schema)}/${encodeURIComponent(name)}`, spec);
    }

    /**
     * List Cortex Agents in a database/schema
     * 
     * @param {string} database - Database identifier
     * @param {string} schema - Schema identifier
     * @param {Object} [options] - Query options
     * @param {string} [options.like] - Filter by name pattern (SQL wildcards)
     * @param {string} [options.fromName] - Fetch rows after this name
     * @param {number} [options.showLimit] - Max number of rows
     * @returns {Promise<Array>} Array of agent objects
     * 
     * @example
     * const agents = await agentsAPI.list('MY_DB', 'MY_SCHEMA');
     * const filtered = await agentsAPI.list('MY_DB', 'MY_SCHEMA', { like: 'SALES%' });
     */
    async list(database, schema, options = {}) {
        const query = {};
        if (options.like) query.like = options.like;
        if (options.fromName) query.fromName = options.fromName;
        if (options.showLimit) query.showLimit = options.showLimit;

        return await this.get(this._basePath(database, schema), { query });
    }

    /**
     * Delete a Cortex Agent
     * 
     * @param {string} database - Database identifier
     * @param {string} schema - Schema identifier
     * @param {string} name - Agent name
     * @param {Object} [options] - Delete options
     * @param {boolean} [options.ifExists] - If true, don't error when agent doesn't exist
     * @returns {Promise<{status: string}>} Deletion status
     * 
     * @example
     * await agentsAPI.delete('MY_DB', 'MY_SCHEMA', 'MY_AGENT');
     */
    async delete(database, schema, name, options = {}) {
        const query = {};
        if (options.ifExists) query.ifExists = 'true';

        return await super.delete(
            `${this._basePath(database, schema)}/${encodeURIComponent(name)}`,
            { query }
        );
    }

    /**
     * Run a Cortex Agent (streaming SSE response)
     * 
     * Returns an async generator that yields parsed SSE events from the agent.
     * 
     * @param {string} database - Database identifier
     * @param {string} schema - Schema identifier
     * @param {string} name - Agent name
     * @param {Object} body - Run request body
     * @param {Array} body.messages - Array of message objects [{role, content}]
     * @param {number} [body.thread_id] - Thread ID for conversation context
     * @param {number} [body.parent_message_id] - Parent message ID for threading
     * @param {Object} [body.tool_choice] - Tool choice configuration (e.g., { type: 'auto' })
     * @returns {AsyncGenerator<{event: string, data: Object|string}>} SSE event stream
     * 
     * @example
     * const events = agentsAPI.run('MY_DB', 'MY_SCHEMA', 'MY_AGENT', {
     *     messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
     *     thread_id: 123456,
     *     tool_choice: { type: 'auto' }
     * });
     * 
     * for await (const { event, data } of events) {
     *     if (event === 'done') break;
     *     console.log(data);
     * }
     */
    run(database, schema, name, body) {
        const path = `${this._basePath(database, schema)}/${encodeURIComponent(name)}:run`;
        return this.stream(path, body);
    }
}

module.exports = AgentsAPI;
