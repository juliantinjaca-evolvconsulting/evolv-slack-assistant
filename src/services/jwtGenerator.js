/**
 * JWT Generator - Creates JWT tokens for Snowflake authentication
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const CONSTANTS = require('../config/constants');

class JWTGenerator {
    constructor() {
        this.account = process.env.SNOWFLAKE_ACCOUNT.toUpperCase();
        this.user = process.env.SNOWFLAKE_USER.toUpperCase();
        this.qualifiedUsername = `${this.account}.${this.user}`;
        this.publicKeyFingerprint = null;
        this.lifetime = CONSTANTS.JWT.LIFETIME_SECONDS;
        this.renewalDelay = CONSTANTS.JWT.RENEWAL_DELAY_SECONDS;
        this.privateKey = null;
        this.renewTime = Date.now() / 1000;
        this.token = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        // Priority: RSA_PRIVATE_KEY_FILE > RSA_PRIVATE_KEY
        const keyFile = process.env.RSA_PRIVATE_KEY_FILE;
        const keyEnv = process.env.RSA_PRIVATE_KEY;
        
        if (keyFile) {
            // Read from mounted file (preferred for containers)
            this.privateKey = fs.readFileSync(keyFile, 'utf8');
            console.log(`[JWT] Private key loaded from file: ${keyFile}`);
        } else if (keyEnv) {
            // Detect base64 encoding (PEM "-----" encodes to "LS0tLS")
            if (keyEnv.startsWith('LS0tLS')) {
                this.privateKey = Buffer.from(keyEnv, 'base64').toString('utf8');
                console.log('[JWT] Private key decoded from base64');
            } else {
                // Handle escaped newlines from env file
                this.privateKey = keyEnv.replace(/\\n/g, '\n');
            }
        } else {
            throw new Error('RSA_PRIVATE_KEY or RSA_PRIVATE_KEY_FILE must be set');
        }
        
        this.publicKeyFingerprint = this.calculatePublicKeyFingerprint();
        this.token = this.generateToken();
        this.initialized = true;
        
        console.log(`[JWT] Generator initialized for ${this.qualifiedUsername}`);
    }

    /**
     * Generate a new JWT token
     * @returns {string} - JWT token
     */
    generateToken() {
        if (!this.privateKey) {
            throw new Error('JWT Generator not initialized. Call initialize() first.');
        }
        
        const now = Math.floor(Date.now() / 1000);
        this.renewTime = now + this.renewalDelay;
        
        const payload = {
            iss: `${this.qualifiedUsername}.${this.publicKeyFingerprint}`,
            sub: this.qualifiedUsername,
            iat: now,
            exp: now + this.lifetime
        };
        
        return jwt.sign(payload, this.privateKey, { algorithm: 'RS256' });
    }

    /**
     * Get current token, renewing if necessary
     * @returns {string} - JWT token
     */
    getToken() {
        if (!this.initialized) {
            throw new Error('JWT Generator not initialized. Call initialize() first.');
        }
        
        if (Date.now() / 1000 >= this.renewTime) {
            this.token = this.generateToken();
        }
        return this.token;
    }

    /**
     * Calculate public key fingerprint from private key
     * @returns {string} - SHA256 fingerprint
     */
    calculatePublicKeyFingerprint() {
        const publicKey = crypto.createPublicKey(this.privateKey);
        const derPublicKey = publicKey.export({ type: 'spki', format: 'der' });
        return `SHA256:${crypto.createHash('sha256').update(derPublicKey).digest('base64')}`;
    }
}

module.exports = JWTGenerator;
