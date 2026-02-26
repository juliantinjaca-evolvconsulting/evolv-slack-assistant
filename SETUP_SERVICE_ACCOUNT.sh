#!/bin/bash
# ============================================================================
# Sales Assistant - Service Account Setup Instructions
# Execute each section manually, one command at a time
# ============================================================================

# ============================================================================
# STEP 1: RSA Keys - COMPLETED
# Keys generated: rsa_key_svc.p8 (private) and rsa_key_svc.pub (public)
# ============================================================================

# ============================================================================
# STEP 2: Create Snowflake Service Account
# Run these SQL commands in Snowflake (Snowsight or SnowSQL)
# ============================================================================

# --- SQL to execute in Snowflake ---
# USE ROLE ACCOUNTADMIN;
#
# CREATE USER SVC_SALES_ASSISTANT
#   TYPE = SERVICE
#   RSA_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6ITR+h057AaXdWNmyeOQkby7s21pM2oCLuUqFHLAJcM50vVFD/YcTIwcW995pqxDdu6Ytx0Wak1DFtrymtU2oPfrfrNsYvjmkOW1mFkjiEEA+vaE8kKwRFb041GxyH5y51/ZewbeoN9g9Y1KeCPjHl1QeWHejyruZBIe4MiaKexPS3Y9EEQWubVkVaqKr8HzepHIQ6AFgrb3oxTjYGPhgXcXXO+LMbkDgm7Wfr76qSrbONDlqQqvMyGoSYNYZJC15ip10qB3EvBOEzM0GM6FB8n7LLwkyDNtGo9QqqeqAfv9tlz0H9QpGLgtrX3G7mnlupnWEB8xtK27fo0sUI9vOQIDAQAB'
#   DEFAULT_WAREHOUSE = 'COMPUTE_WH'
#   DEFAULT_ROLE = 'SALES_ASSIST_DELIVERY_ACCELERATOR_ADMIN';
#
# GRANT ROLE SALES_ASSIST_DELIVERY_ACCELERATOR_ADMIN TO USER SVC_SALES_ASSISTANT;
#
# -- Verify the user was created:
# DESCRIBE USER SVC_SALES_ASSISTANT;
# --- End SQL ---

# ============================================================================
# STEP 3: Get Private Key for Azure Container App
# Convert key to single line format for environment variable
# ============================================================================

# View the private key content (copy for Azure)
cat rsa_key_svc.p8

# Or convert to single line with \n (for environment variable)
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' rsa_key_svc.p8

# ============================================================================
# STEP 4: Azure Container App - Environment Variables
# Set these as secrets/env vars in Azure Container App
# ============================================================================

# Required environment variables for production:
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_APP_TOKEN=xapp-...
# SNOWFLAKE_ACCOUNT=AOVNGED-ENNOVATE
# SNOWFLAKE_USER=SVC_SALES_ASSISTANT
# SNOWFLAKE_ROLE=SALES_ASSIST_DELIVERY_ACCELERATOR_ADMIN
# SNOWFLAKE_WAREHOUSE=COMPUTE_WH
# RSA_PRIVATE_KEY=<paste single-line key with \n>
# CORTEX_AGENT_ENDPOINT=https://aovnged-ennovate.snowflakecomputing.com/api/v2/databases/SALES_ASSIST_DELIVERY_ACCELERATORS/schemas/SALES_ASSISTANT_MVP/agents/SALES_ASSIST_AGENT:run
# AUTHORIZED_USERGROUP_ID=S0AHF4EPGAY
# AUTH_CACHE_TTL_MINUTES=2

# ============================================================================
# STEP 5: Test Locally with Service Account (Optional)
# ============================================================================

# Update .env:
# SNOWFLAKE_USER=SVC_SALES_ASSISTANT
# RSA_PRIVATE_KEY_PATH=/path/to/rsa_key_svc.p8

# Run:
# npm start

# ============================================================================
# CLEANUP: Delete local private key after configuring Azure
# ============================================================================

# rm rsa_key_svc.p8
# (Keep rsa_key_svc.pub for reference)
