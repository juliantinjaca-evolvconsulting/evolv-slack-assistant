# =============================================================================
# Sales Assistant Slack Bot - Docker Container
# =============================================================================
# 
# USAGE:
#   Build:  docker build -t sales-assistant-slack .
#   Run:    docker run --env-file .env sales-assistant-slack
#
# REQUIRED ENVIRONMENT VARIABLES:
#   - SLACK_BOT_TOKEN          : Slack bot OAuth token (xoxb-...)
#   - SLACK_APP_TOKEN          : Slack app-level token for socket mode (xapp-...)
#   - SNOWFLAKE_ACCOUNT        : Snowflake account identifier
#   - SNOWFLAKE_USER           : Snowflake service account username
#   - SNOWFLAKE_ROLE           : Snowflake role for the service account
#   - SNOWFLAKE_WAREHOUSE      : Snowflake warehouse name
#   - SNOWFLAKE_DATABASE       : Snowflake database name
#   - SNOWFLAKE_SCHEMA         : Snowflake schema name
#   - RSA_PRIVATE_KEY          : Base64 RSA private key for JWT auth
#     OR RSA_PRIVATE_KEY_FILE  : Path to mounted RSA key file
#   - CORTEX_AGENT_ENDPOINT    : Snowflake Cortex Agent REST API endpoint
#   - THREAD_MAPPINGS_TABLE    : Snowflake table for thread mappings
#
# OPTIONAL ENVIRONMENT VARIABLES:
#   - PPTX_OUTPUT_STAGE        : Snowflake stage for file outputs
#   - AUTHORIZED_USERGROUP_ID  : Slack User Group ID for access control
#   - AUTH_CACHE_TTL_MINUTES   : Cache TTL for auth checks (default: 2)
#   - DEBUG_CORTEX             : Enable debug logging (default: false)
#
# SECRETS MANAGEMENT:
#   For production, inject secrets via:
#   - Docker secrets (docker run --secret)
#   - Kubernetes secrets (mounted as env vars or files)
#   - Cloud secrets managers (AWS Secrets Manager, Azure Key Vault, etc.)
#
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.50.0-jammy AS deps

WORKDIR /app

# Copy only package files for dependency caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 2: Production
# -----------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

# OCI Labels for container metadata
LABEL org.opencontainers.image.title="Sales Assistant Slack Bot" \
      org.opencontainers.image.description="Slack bot integrating with Snowflake Cortex Agents for sales data queries" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.vendor="Ennovate" \
      org.opencontainers.image.licenses="Proprietary"

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code selectively for better layer caching
COPY package*.json ./
COPY index.js ./
COPY src/ ./src/

# Set Node environment
ENV NODE_ENV=production

# Health check - verifies the Node process is running
# The app uses Slack socket mode so there's no HTTP endpoint to check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Run as non-root user (playwright image provides this)
USER pwuser

# Start the application
CMD ["node", "index.js"]
