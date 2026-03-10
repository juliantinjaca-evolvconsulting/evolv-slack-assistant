# Deploy to Azure Container Instances

This guide covers deploying the Sales Assistant Slack bot to Azure Container Instances (ACI).

## Prerequisites

- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed
- [Docker](https://docs.docker.com/get-docker/) installed
- Azure subscription with permissions to create resources
- Docker image built and ready to push

## Step 1: Login to Azure

```bash
az login
```

Set your subscription:

```bash
az account set --subscription "YOUR_SUBSCRIPTION_NAME"
```

## Step 2: Create Azure Container Registry

Create the ACR with admin enabled:

```bash
az acr create --resource-group YOUR_RESOURCE_GROUP --name YOUR_ACR_NAME --sku Basic --admin-enabled true
```

Get the ACR password (save this for later):

```bash
az acr credential show --name YOUR_ACR_NAME --query "passwords[0].value" -o tsv
```

## Step 3: Build and Push Docker Image

**Important:** Build with `--platform linux/amd64` to ensure compatibility with Azure Container Instances.

Login to ACR:

```bash
docker login YOUR_ACR_NAME.azurecr.io -u YOUR_ACR_NAME -p "ACR_PASSWORD"
```

Build the image:

```bash
docker build --platform linux/amd64 -t YOUR_ACR_NAME.azurecr.io/sales-assistant-slack:v1.0.0 .
```

Push to ACR:

```bash
docker push YOUR_ACR_NAME.azurecr.io/sales-assistant-slack:v1.0.0
```

## Step 4: Create Deployment Configuration

Create a `deploy.yaml` file with your configuration:

```yaml
apiVersion: "2021-09-01"
location: YOUR_LOCATION
name: sales-assistant-slack
properties:
  containers:
    - name: sales-assistant-slack
      properties:
        image: YOUR_ACR_NAME.azurecr.io/sales-assistant-slack:v1.0.0
        resources:
          requests:
            cpu: 1
            memoryInGb: 2
        environmentVariables:
          - name: SLACK_BOT_TOKEN
            value: "xoxb-your-bot-token"
          - name: SLACK_APP_TOKEN
            value: "xapp-your-app-token"
          - name: SNOWFLAKE_ACCOUNT
            value: "YOUR_ACCOUNT"
          - name: SNOWFLAKE_USER
            value: "YOUR_USER"
          - name: SNOWFLAKE_ROLE
            value: "YOUR_ROLE"
          - name: SNOWFLAKE_WAREHOUSE
            value: "YOUR_WAREHOUSE"
          - name: SNOWFLAKE_DATABASE
            value: "YOUR_DATABASE"
          - name: SNOWFLAKE_SCHEMA
            value: "YOUR_SCHEMA"
          - name: CORTEX_AGENT_ENDPOINT
            value: "https://your-account.snowflakecomputing.com/api/v2/databases/DB/schemas/SCHEMA/agents/AGENT:run"
          - name: THREAD_MAPPINGS_TABLE
            value: "DATABASE.SCHEMA.SLACK_THREAD_MAPPINGS"
          - name: PPTX_OUTPUT_STAGE
            value: "DATABASE.SCHEMA.OUTPUT_STAGE"
          - name: AUTHORIZED_USERGROUP_ID
            value: "YOUR_USERGROUP_ID"
          - name: ENABLE_ACCESS_CONTROL
            value: "true"
          - name: AUTH_CACHE_TTL_MINUTES
            value: "2"
          - name: DEBUG_CORTEX
            value: "false"
          - name: RSA_PRIVATE_KEY
            secureValue: "YOUR_BASE64_ENCODED_RSA_KEY"
  osType: Linux
  restartPolicy: Always
  imageRegistryCredentials:
    - server: YOUR_ACR_NAME.azurecr.io
      username: YOUR_ACR_NAME
      password: "ACR_PASSWORD"
type: Microsoft.ContainerInstance/containerGroups
```

**Note:** Generate the Base64-encoded RSA key with:

```bash
cat rsa_key.p8 | base64 | tr -d '\n'
```

## Step 5: Deploy to Azure

```bash
az container create --resource-group YOUR_RESOURCE_GROUP --file deploy.yaml
```

## Useful Commands

### View logs

```bash
az container logs --resource-group YOUR_RESOURCE_GROUP --name sales-assistant-slack --follow
```

### Check status

```bash
az container show --resource-group YOUR_RESOURCE_GROUP --name sales-assistant-slack --query "{Status:instanceView.state}" -o table
```

### Restart container

```bash
az container restart --resource-group YOUR_RESOURCE_GROUP --name sales-assistant-slack
```

### Stop container

```bash
az container stop --resource-group YOUR_RESOURCE_GROUP --name sales-assistant-slack
```

### Delete container

```bash
az container delete --resource-group YOUR_RESOURCE_GROUP --name sales-assistant-slack --yes
```

## Update Deployment

To deploy a new version:

1. Build and push new image with updated tag
2. Update `deploy.yaml` with new image tag
3. Delete existing container and redeploy:

```bash
az container delete --resource-group YOUR_RESOURCE_GROUP --name sales-assistant-slack --yes
az container create --resource-group YOUR_RESOURCE_GROUP --file deploy.yaml
```
