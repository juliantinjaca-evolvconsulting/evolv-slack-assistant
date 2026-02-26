/**
 * CortexAPI - Central registry for all Snowflake Cortex REST APIs
 * 
 * Provides a single entry point to access all Snowflake API clients.
 * Uses the Registry pattern for extensibility — adding a new API is as simple as:
 * 
 * 1. Create a new class extending SnowflakeClient with `static namespace = 'myapi'`
 * 2. Register it: `api.register(MyAPI)` in the create() factory
 * 
 * @example
 * const api = CortexAPI.create(jwtGenerator);
 * 
 * // Access Threads API
 * const threadId = await api.threads.create('slack_bot');
 * 
 * // Access Agents API
 * const agents = await api.agents.list('MY_DB', 'MY_SCHEMA');
 * const events = api.agents.run('MY_DB', 'MY_SCHEMA', 'MY_AGENT', body);
 */

const ThreadsAPI = require('./ThreadsAPI');
const AgentsAPI = require('./AgentsAPI');

class CortexAPI {
    /**
     * @param {Object} jwtGenerator - JWT generator instance for authentication
     * @param {Object} [options] - Configuration options passed to all API clients
     * @param {string} [options.baseUrl] - Base URL for Snowflake API
     * @param {string} [options.role] - Snowflake role
     * @param {string} [options.warehouse] - Snowflake warehouse
     */
    constructor(jwtGenerator, options = {}) {
        this.jwtGenerator = jwtGenerator;
        this.options = options;
        this._registry = new Map();
    }

    /**
     * Register an API class under its namespace
     * 
     * The class must have a static `namespace` property that defines
     * the accessor name (e.g., 'threads' -> api.threads).
     * 
     * @param {typeof import('./SnowflakeClient')} APIClass - API class extending SnowflakeClient
     * @throws {Error} If namespace is missing or already registered
     * 
     * @example
     * api.register(ThreadsAPI);  // accessible as api.threads
     * api.register(AgentsAPI);   // accessible as api.agents
     */
    register(APIClass) {
        const namespace = APIClass.namespace;
        if (!namespace) {
            throw new Error(`API class ${APIClass.name} must define a static 'namespace' property`);
        }
        if (this._registry.has(namespace)) {
            throw new Error(`Namespace '${namespace}' is already registered`);
        }

        const instance = new APIClass(this.jwtGenerator, this.options);
        this._registry.set(namespace, instance);
        this[namespace] = instance;
    }

    /**
     * Get a registered API by namespace
     * 
     * @param {string} namespace - API namespace
     * @returns {import('./SnowflakeClient')|undefined} API instance
     */
    get(namespace) {
        return this._registry.get(namespace);
    }

    /**
     * List all registered API namespaces
     * 
     * @returns {string[]} Array of namespace names
     */
    listAPIs() {
        return Array.from(this._registry.keys());
    }

    /**
     * Factory method — creates a CortexAPI with all known APIs registered
     * 
     * To add a new API, create the class and add one line here.
     * 
     * @param {Object} jwtGenerator - JWT generator instance
     * @param {Object} [options] - Configuration options
     * @returns {CortexAPI} Fully configured API instance
     * 
     * @example
     * const api = CortexAPI.create(jwtGenerator);
     * // api.threads  -> ThreadsAPI
     * // api.agents   -> AgentsAPI
     */
    static create(jwtGenerator, options = {}) {
        const api = new CortexAPI(jwtGenerator, options);

        // Register all known APIs here
        api.register(ThreadsAPI);
        api.register(AgentsAPI);
        // Future: api.register(SearchAPI);
        // Future: api.register(AnalystAPI);

        return api;
    }
}

module.exports = CortexAPI;
