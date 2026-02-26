/**
 * Snowflake API Clients
 * 
 * Export all Snowflake-related API clients for easy importing.
 * 
 * @example
 * const { CortexAPI } = require('./snowflake');
 * const api = CortexAPI.create(jwtGenerator);
 * // api.threads, api.agents, etc.
 * 
 * // Or import individual clients:
 * const { SnowflakeClient, ThreadsAPI, AgentsAPI } = require('./snowflake');
 */

const SnowflakeClient = require('./SnowflakeClient');
const ThreadsAPI = require('./ThreadsAPI');
const AgentsAPI = require('./AgentsAPI');
const CortexAPI = require('./CortexAPI');

module.exports = {
    SnowflakeClient,
    ThreadsAPI,
    AgentsAPI,
    CortexAPI
};
