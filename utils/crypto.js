const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

// Key must be 32 bytes. We pad it if it's shorter for demo purposes, 
// but in production, ensure it's exactly 32 chars.
const getKey = () => {
    const key = process.env.ENCRYPTION_KEY || 'default_secret_key_32_chars_long!!';
    // Ensure 32 byte buffer
    return Buffer.alloc(32, key);
};

const encrypt = (text) => {
    if (!text) return null;
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (e) {
        console.error("Encryption failed:", e);
        return null;
    }
};

const decrypt = (encryptedText) => {
    if (!encryptedText) return null;
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) {
            console.warn("Invalid encrypted text format");
            return null;
        }
        
        const [ivHex, authTagHex, contentHex] = parts;
        const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        
        let decrypted = decipher.update(contentHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        // If the key changed or data is corrupted, this will fail.
        // We log it and return null instead of crashing the server (HTTP 500).
        console.error("Decryption failed (Key mismatch?):", error.message);
        return null;
    }
};

module.exports = { encrypt, decrypt };