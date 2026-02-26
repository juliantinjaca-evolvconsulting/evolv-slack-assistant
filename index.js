/**
 * Sales Assistant Slack Bot
 * Main entry point using Slack Bolt
 */
require('dotenv').config();

const { App } = require('@slack/bolt');
const CortexChat = require('./src/services/cortexChat');
const JWTGenerator = require('./src/services/jwtGenerator');
const { CortexAPI } = require('./src/services/snowflake');
const { createChartBlocks, createTableBlocks, sendTableAsImage, createTextBlocks, extractStageFiles, removeStageFilePaths, createFileDownloadBlocks } = require('./src/blocks');
const { StreamThrottle } = require('./src/utils/streamThrottle');
const CONSTANTS = require('./src/config/constants');

// Feature flag for streaming (can be disabled if issues arise)
const ENABLE_STREAMING = process.env.ENABLE_STREAMING !== 'false';

/**
 * Sanitize error messages to avoid exposing internal details
 * @param {Error} error - The error object
 * @returns {string} Safe error message for users
 */
function sanitizeErrorMessage(error) {
    const message = error?.message || '';
    // Known safe errors that can be shown to users
    const safePatterns = [
        /timeout/i,
        /rate limit/i,
        /too many requests/i,
        /invalid query/i,
        /not found/i
    ];
    if (safePatterns.some(pattern => pattern.test(message))) {
        return message;
    }
    return 'An unexpected error occurred. Please try again.';
}

// Maximum message length to prevent DoS
const MAX_MESSAGE_LENGTH = CONSTANTS.SLACK.MAX_MESSAGE_LENGTH;

/**
 * Generate a presigned URL for a file in a Snowflake stage
 * @param {string} stageName - Full stage name (DATABASE.SCHEMA.STAGE)
 * @param {string} fileName - File name within the stage
 * @param {number} expirationSeconds - URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns {Promise<string|null>} Presigned URL or null if failed
 */
async function getPresignedUrl(stageName, fileName, expirationSeconds = CONSTANTS.FILES.PRESIGNED_URL_EXPIRATION_SECONDS) {
    try {
        const parts = stageName.split('.');
        const database = parts[0];
        const schema = parts[1];
        const safeFileName = fileName.replace(/'/g, "''");
        const sql = `SELECT GET_PRESIGNED_URL('@${stageName}', '${safeFileName}', ${expirationSeconds}) AS url`;
        
        const result = await cortexAPI.agents.executeSQL(sql, { database, schema });
        
        if (result?.data?.[0]?.[0]) {
            return result.data[0][0];
        }
        
        console.error('Unexpected SQL result format for presigned URL:', JSON.stringify(result));
        return null;
    } catch (error) {
        console.error('Failed to generate presigned URL:', error.message);
        return null;
    }
}

// Initialize JWT Generator, CortexAPI, and CortexChat
const jwtGenerator = new JWTGenerator();
const cortexAPI = CortexAPI.create(jwtGenerator);
const cortexChat = new CortexChat(cortexAPI);

// Suggested prompts for the assistant
const SUGGESTED_PROMPTS = [
    {
        title: "Sentiment Analysis",
        message: "Which accounts have the lowest sentiment scores?"
    },
    {
        title: "Top Accounts",
        message: "What are my top 10 accounts by open pipeline?"
    },
    {
        title: "Recent Interactions",
        message: "Show me customer interactions from last 7 days"
    },
    {
        title: "Lost Deals",
        message: "Which deals did we lose this quarter and why?"
    }
];

// Initialize the Slack app
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN
});

// ============================================================================
// ACCESS CONTROL - User Group based authorization
// ============================================================================
const AUTHORIZED_USERGROUP_ID = process.env.AUTHORIZED_USERGROUP_ID;
const AUTH_CACHE_TTL_MS = (parseInt(process.env.AUTH_CACHE_TTL_MINUTES, 10) || 2) * 60 * 1000; // Default: 2 minutes

// In-memory cache for authorized users
let authCache = { users: new Set(), expiresAt: 0 };

/**
 * Fetch authorized users from Slack User Group with caching
 * @param {WebClient} client - Slack WebClient
 * @returns {Promise<Set<string>>} Set of authorized user IDs
 */
async function getAuthorizedUsers(client) {
    if (Date.now() < authCache.expiresAt) {
        return authCache.users;
    }
    
    const result = await client.usergroups.users.list({ usergroup: AUTHORIZED_USERGROUP_ID });
    authCache.users = new Set(result.users || []);
    authCache.expiresAt = Date.now() + AUTH_CACHE_TTL_MS;
    console.log(`[Auth] Refreshed authorized users cache: ${authCache.users.size} users`);
    return authCache.users;
}

// Global middleware for access control
if (AUTHORIZED_USERGROUP_ID) {
    app.use(async ({ body, client, next, logger }) => {
        // Extract user ID from various event types
        // - message events: body.event.user
        // - assistant_thread_started: body.event.assistant_thread.user_id
        // - other events: body.user_id or body.user.id
        const userId = body?.event?.user 
            || body?.event?.assistant_thread?.user_id 
            || body?.user_id 
            || body?.user?.id;
        
        // If no user ID found, let it through (some system events)
        if (!userId) {
            return next();
        }
        
        let authorizedUsers;
        try {
            authorizedUsers = await getAuthorizedUsers(client);
        } catch (error) {
            // Fail-closed: deny access if we can't verify authorization
            logger.warn(`[Auth] Failed to fetch authorized users: ${error.message}`);
            return; // Do not call next()
        }
        
        if (authorizedUsers.has(userId)) {
            // User is authorized
            return next();
        }
        
        // User is NOT authorized - send denial message
        logger.info(`[Auth] Unauthorized access attempt by user ${userId}`);
        
        const channel = body?.event?.channel || body?.event?.assistant_thread?.channel_id;
        const threadTs = body?.event?.thread_ts || body?.event?.assistant_thread?.thread_ts;
        
        if (channel) {
            try {
                await client.chat.postMessage({
                    channel,
                    text: "You don't have access to this Assistant. Please contact the administrator to request access.",
                    ...(threadTs ? { thread_ts: threadTs } : {})
                });
            } catch (err) {
                logger.warn(`[Auth] Failed to send denial message: ${err.message}`);
            }
        }
        
        // Do NOT call next() - block unauthorized access
    });
    console.log(`[Auth] Access control enabled for User Group: ${AUTHORIZED_USERGROUP_ID}`);
} else {
    console.log('[Auth] No AUTHORIZED_USERGROUP_ID configured - bot is open to all users');
}

// Store bot user ID for mention detection
let botUserId = null;

// Handle assistant thread started
app.event('assistant_thread_started', async ({ event, client, logger }) => {
    try {
        const { channel_id, thread_ts } = event.assistant_thread;
        
        // Resolve the user who started this thread.
        // assistant_thread_started is a DM event; get the user from the DM channel.
        let userId = null;
        try {
            const info = await client.conversations.info({ channel: channel_id });
            userId = info.channel?.user;
        } catch (_) { /* fallback below */ }
        
        if (userId) {
            await cortexChat.resetForUser(userId, thread_ts);
            logger.info(`Reset Snowflake thread for user ${userId} (new chat)`);
        }
        
        // Send welcome message
        await client.chat.postMessage({
            channel: channel_id,
            thread_ts: thread_ts,
            text: "Hi! I'm your Sales Assistant. I can help you query data about opportunities, pipeline, leads, calls and more. Ask me anything!"
        });
        
        // Set suggested prompts
        await client.assistant.threads.setSuggestedPrompts({
            channel_id: channel_id,
            thread_ts: thread_ts,
            prompts: SUGGESTED_PROMPTS,
            title: "Here are some questions you can ask:"
        });
        
    } catch (error) {
        logger.error('Error in assistant_thread_started:', error);
    }
});

// Handle user messages in assistant thread and channel mentions
app.event('message', async ({ event, client, logger }) => {
    try {
        // Ignore bot messages
        if (event.bot_id) return;
        
        // Accept messages from DMs, public channels, and private channels
        if (!['im', 'channel', 'group'].includes(event.channel_type)) return;
        
        const isDirectMessage = event.channel_type === 'im';
        const isMentioned = botUserId && event.text?.includes(`<@${botUserId}>`);
        const isInThread = !!event.thread_ts;
        
        // In DMs: only respond in threads (Assistant API behavior)
        // In channels: respond when mentioned (with or without thread)
        if (isDirectMessage && !isInThread) return;
        if (!isDirectMessage && !isMentioned) return;
        
        // Remove bot mention from message text for cleaner queries
        let userMessage = event.text || '';
        if (botUserId) {
            userMessage = userMessage.replace(`<@${botUserId}>`, '').trim();
        }
        
        // Use thread_ts if in a thread, otherwise use the message ts to start a new thread
        const conversationId = event.thread_ts || event.ts;
        const channelId = event.channel;
        
        if (!userMessage.trim()) return;
        
        // Validate message length to prevent DoS
        if (userMessage.length > MAX_MESSAGE_LENGTH) {
            await client.chat.postMessage({
                channel: channelId,
                thread_ts: conversationId,
                text: `Your message is too long. Please keep queries under ${MAX_MESSAGE_LENGTH} characters.`
            });
            return;
        }
        
        logger.info(`Processing message: ${userMessage.substring(0, 50)}...`);
        
        // Set thinking status
        await client.assistant.threads.setStatus({
            channel_id: channelId,
            thread_ts: conversationId,
            status: "Querying sales data..."
        });
        
        let response;
        
        if (ENABLE_STREAMING) {
            // Streaming mode: show thinking in real-time + typing indicator
            console.log('[Streaming] Starting streaming mode...');
            
            let tokenCount = 0;
            let lastStatusUpdate = Date.now();
            const STATUS_UPDATE_INTERVAL = CONSTANTS.STREAM.STATUS_UPDATE_INTERVAL_MS;
            
            // Post initial thinking message
            const thinkingMsg = await client.chat.postMessage({
                channel: channelId,
                thread_ts: conversationId,
                text: '_Thinking..._'
            });
            
            // Create throttled updater for thinking message
            let thinkingText = '';
            const thinkingThrottle = new StreamThrottle({
                minInterval: CONSTANTS.STREAM.THROTTLE_MIN_INTERVAL_MS,
                minChars: CONSTANTS.STREAM.THROTTLE_MIN_CHARS,
                overwrite: true,
                onFlush: async (text) => {
                    try {
                        await client.chat.update({
                            channel: channelId,
                            ts: thinkingMsg.ts,
                            text: text
                        });
                    } catch (e) {
                        // Update failed, continue anyway
                    }
                }
            });
            
            // Query with streaming callbacks
            response = await cortexChat.sendMessageStreaming(
                userMessage, 
                conversationId,
                event.user,  // Pass user ID to store in thread mapping
                // onToken - count tokens
                async (token) => {
                    tokenCount++;
                },
                // onStatus - update typing indicator
                async (statusMessage) => {
                    const now = Date.now();
                    if (now - lastStatusUpdate > STATUS_UPDATE_INTERVAL) {
                        try {
                            await client.assistant.threads.setStatus({
                                channel_id: channelId,
                                thread_ts: conversationId,
                                status: statusMessage
                            });
                            console.log(`[Streaming] Status: ${statusMessage}`);
                        } catch (e) {
                            // Status update failed, continue anyway
                        }
                        lastStatusUpdate = now;
                    }
                },
                // onThinking - update thinking message
                async (thinkingToken) => {
                    console.log(`[Streaming] Thinking token: "${thinkingToken.substring(0, 50)}..."`);
                    thinkingText = thinkingToken;
                    await thinkingThrottle.push(thinkingToken);
                }
            );
            
            // Complete thinking throttle (final flush)
            await thinkingThrottle.complete();
            
            // Delete thinking message before posting final response
            try {
                await client.chat.delete({
                    channel: channelId,
                    ts: thinkingMsg.ts
                });
            } catch (e) {
                // If delete fails, try to update it to indicate completion
                try {
                    await client.chat.update({
                        channel: channelId,
                        ts: thinkingMsg.ts,
                        text: '_Done thinking_'
                    });
                } catch (e2) {
                    // Ignore
                }
            }
            
            console.log(`[Streaming] Complete - tokens: ${tokenCount}, thinking: ${thinkingText.length} chars, text: ${response?.text?.length || 0} chars`);
            
        } else {
            // Non-streaming mode: wait for complete response
            response = await cortexChat.sendMessage(userMessage, conversationId, event.user);
        }
        
        logger.info(`Response received - text: ${!!response?.text}, resultSet: ${!!response?.resultSet}, chart: ${!!response?.chart}`);
        
        if (!response) {
            await client.chat.postMessage({
                channel: channelId,
                thread_ts: conversationId,
                text: "Could not get a response. Please try again."
            });
            return;
        }
        
        // Build response blocks
        const blocks = [];
        let textFallback = "";
        
        // Add chart if available
        if (response.chart?.spec) {
            const chartBlocks = createChartBlocks(response.chart);
            blocks.push(...chartBlocks);
            textFallback = response.chart.spec.title || "Chart results";
        }
        
        // Add table if available (try image first, fallback to text)
        if (response.resultSet?.data?.length > 0) {
            const tableSentAsImage = await sendTableAsImage(
                client, 
                channelId, 
                conversationId, 
                response.resultSet, 
                response.tableTitle
            );
            
            if (!tableSentAsImage) {
                // Fallback to text-based table
                const tableBlocks = createTableBlocks(response.resultSet, response.tableTitle);
                blocks.push(...tableBlocks);
            }
            textFallback = textFallback || "Table results";
        }
        
        // Add text if available (with file download detection)
        if (response.text?.trim()) {
            const stageFiles = extractStageFiles(response.text);
            
            if (stageFiles.length > 0) {
                // Generate presigned URLs and create download buttons
                for (const file of stageFiles) {
                    try {
                        const presignedUrl = await getPresignedUrl(file.stageName, file.fileName);
                        if (presignedUrl) {
                            const downloadBlocks = createFileDownloadBlocks(
                                file.fileName, 
                                presignedUrl, 
                                file.extension
                            );
                            blocks.push(...downloadBlocks);
                        }
                    } catch (err) {
                        console.error(`Failed to create download button for ${file.fileName}:`, err.message);
                    }
                }
                
                // Remove file paths from text and add remaining text
                const cleanedText = removeStageFilePaths(response.text);
                if (cleanedText?.trim()) {
                    const textBlocks = createTextBlocks(cleanedText);
                    blocks.push(...textBlocks);
                    textFallback = textFallback || cleanedText;
                }
            } else {
                const textBlocks = createTextBlocks(response.text);
                blocks.push(...textBlocks);
                textFallback = textFallback || response.text;
            }
        }
        
        // Fallback if no content
        if (blocks.length === 0) {
            blocks.push(...createTextBlocks("No response from agent."));
            textFallback = "No response from agent.";
        }
        
        // Clear the thinking status
        await client.assistant.threads.setStatus({
            channel_id: channelId,
            thread_ts: conversationId,
            status: ""
        });
        
        logger.info(`Sending response with ${blocks.length} blocks`);
        
        // Send response (Slack limit is 50 blocks)
        await client.chat.postMessage({
            channel: channelId,
            thread_ts: conversationId,
            text: textFallback.substring(0, 3000),
            blocks: blocks.slice(0, 50)
        });
        
        // Share with mentioned users if "share" is in the message
        const shareKeywords = ['share', 'send', 'notify', 'tell'];
        const hasShareIntent = shareKeywords.some(keyword => 
            userMessage.toLowerCase().includes(keyword)
        );
        
        if (hasShareIntent) {
            // Find user mentions (excluding the bot)
            const userMentions = userMessage.match(/<@(U[A-Z0-9]+)>/g) || [];
            const mentionedUsers = userMentions
                .map(m => m.replace(/<@|>/g, ''))
                .filter(id => id !== botUserId);
            
            const sharedWith = [];
            for (const userId of mentionedUsers) {
                try {
                    // Open a DM conversation with the user first
                    logger.info(`Opening DM with user ${userId}...`);
                    const dmChannel = await client.conversations.open({
                        users: userId
                    });
                    logger.info(`DM channel opened: ${dmChannel.channel.id}`);
                    
                    const result = await client.chat.postMessage({
                        channel: dmChannel.channel.id,
                        text: `*Analysis shared by <@${event.user}>:*\n\n${textFallback.substring(0, CONSTANTS.SLACK.SECTION_TEXT_MAX)}`,
                        blocks: [
                            {
                                type: "section",
                                text: {
                                    type: "mrkdwn",
                                    text: `*Analysis shared by <@${event.user}>:*`
                                }
                            },
                            { type: "divider" },
                            ...blocks.slice(0, CONSTANTS.SLACK.MAX_BLOCKS - 2)
                        ]
                    });
                    logger.info(`Message sent to DM, ts: ${result.ts}, ok: ${result.ok}`);
                    sharedWith.push(`<@${userId}>`);
                    logger.info(`Shared analysis with user ${userId}`);
                } catch (shareError) {
                    logger.error(`Failed to share with user ${userId}:`, shareError.message);
                    logger.error(`Full error:`, JSON.stringify(shareError.data || shareError, null, 2));
                }
            }
            
            // Confirm in thread that the analysis was shared
            if (sharedWith.length > 0) {
                await client.chat.postMessage({
                    channel: channelId,
                    thread_ts: conversationId,
                    text: `✅ Analysis shared with ${sharedWith.join(', ')}`
                });
            }
        }
        
    } catch (error) {
        logger.error('Error in message handler:', error);
        
        // Try to send error message to user
        try {
            await client.chat.postMessage({
                channel: event.channel,
                thread_ts: event.thread_ts || event.ts,
                text: `Sorry, I encountered an error: ${sanitizeErrorMessage(error)}`
            });
        } catch (e) {
            logger.error('Failed to send error message:', e);
        }
    }
});

// Handle assistant thread context changed
app.event('assistant_thread_context_changed', async ({ logger }) => {
    logger.debug('Thread context changed');
});

// Acknowledge download button clicks (URL buttons open directly, but Slack requires ack)
app.action('download_file', async ({ ack }) => {
    await ack();
});

// Error handler
app.error(async (error) => {
    console.error('App error:', error);
});

// Start the app
(async () => {
    const requiredVars = [
        'SLACK_BOT_TOKEN',
        'SLACK_APP_TOKEN',
        'SNOWFLAKE_ACCOUNT',
        'SNOWFLAKE_USER',
        'CORTEX_AGENT_ENDPOINT'
    ];
    
    const missingVars = requiredVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
        console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
        process.exit(1);
    }
    
    // Validate RSA key is available (either file or env var)
    if (!process.env.RSA_PRIVATE_KEY && !process.env.RSA_PRIVATE_KEY_FILE) {
        console.error('Missing RSA_PRIVATE_KEY or RSA_PRIVATE_KEY_FILE environment variable');
        process.exit(1);
    }
    
    // Initialize JWT Generator (loads private key from env var or local file)
    try {
        console.log('[Init] Initializing JWT Generator...');
        await jwtGenerator.initialize();
        console.log('[Init] JWT Generator initialized successfully');
    } catch (error) {
        console.error('[Init] Failed to initialize JWT Generator:', error.message);
        process.exit(1);
    }
    
    // Initialize CortexChat (loads thread mappings from Snowflake)
    try {
        console.log('[Init] Initializing CortexChat thread store...');
        await cortexChat.initialize();
        console.log('[Init] CortexChat initialized successfully');
    } catch (error) {
        console.error('[Init] Failed to initialize CortexChat:', error.message);
        process.exit(1);
    }
    
    await app.start();
    
    // Get bot user ID for mention detection in channels
    try {
        const authResult = await app.client.auth.test();
        botUserId = authResult.user_id;
        console.log(`Bot user ID: ${botUserId}`);
    } catch (error) {
        console.error('Failed to get bot user ID:', error);
    }
    
    console.log('Sales Assistant Slack Bot is running!');
})();

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
    console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);
    try {
        await app.stop();
        console.log('[Shutdown] Slack app stopped');
    } catch (error) {
        console.error('[Shutdown] Error stopping app:', error.message);
    }
    process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));