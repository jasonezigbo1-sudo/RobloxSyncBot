require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieSession = require('cookie-session');
const axios = require('axios');
const connectDB = require('./lib/mongodb');
const User = require('./models/User');
const Server = require('./models/Server');
const { encrypt, decrypt } = require('./utils/crypto');
const { startBot } = require('./bot'); // Import Bot Logic

const app = express();

// Trust Vercel Proxy
app.set('trust proxy', 1);

app.use(cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(express.json());
app.use(cookieSession({
    name: 'robloxsync_session',
    keys: [process.env.SESSION_SECRET || 'secret'],
    maxAge: 24 * 60 * 60 * 1000,
    secure: true, 
    sameSite: 'lax',
    httpOnly: true
}));

const withDB = (handler) => async (req, res, next) => {
    try {
        await connectDB();
        return handler(req, res, next);
    } catch (error) {
        console.error("Database connection error:", error);
        res.status(500).json({ error: "Database connection failed: " + error.message });
    }
};

app.get('/api/config', (req, res) => {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    res.json({
        clientId: process.env.DISCORD_CLIENT_ID,
        redirectUri: process.env.DISCORD_REDIRECT_URI,
        isBotConfigured: !!botToken && botToken !== 'YOUR_BOT_TOKEN_HERE' && botToken.length > 20
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/auth/login', (req, res) => {
    const { DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI } = process.env;
    const scopes = 'identify guilds';
    const redirectUri = DISCORD_REDIRECT_URI || `https://${req.headers.host}/api/auth/discord/callback`;
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}`;
    res.redirect(url);
});

app.get('/api/auth/discord/callback', withDB(async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code provided');

    try {
        const redirectUri = process.env.DISCORD_REDIRECT_URI || `https://${req.headers.host}/api/auth/discord/callback`;

        const params = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        });

        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', params);
        const { access_token, refresh_token } = tokenRes.data;

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const { id, username, avatar } = userRes.data;
        const avatarUrl = avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png` : null;

        await User.findOneAndUpdate(
            { discordId: id },
            { 
                username, 
                avatar: avatarUrl, 
                accessToken: access_token, 
                refreshToken: refresh_token, 
                lastLogin: new Date() 
            },
            { upsert: true, new: true }
        );

        req.session.userId = id;
        const frontendUrl = process.env.FRONTEND_URL || `https://${req.headers.host}`;
        res.redirect(`${frontendUrl}/?dashboard=true`);
    } catch (err) {
        console.error('Auth Error:', err.response?.data || err.message);
        res.redirect(`/?error=auth_failed`);
    }
}));

app.get('/api/auth/logout', (req, res) => {
    req.session = null;
    res.status(200).json({ success: true });
});

app.get('/api/me', withDB(async (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    const user = await User.findOne({ discordId: req.session.userId });
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ id: user.discordId, username: user.username, avatar: user.avatar });
}));

app.get('/api/servers', withDB(async (req, res) => {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        const user = await User.findOne({ discordId: req.session.userId });
        if (!user) return res.status(401).json({ error: 'User record not found in database' });

        // Fetch User Guilds
        let userGuilds = [];
        try {
            const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { Authorization: `Bearer ${user.accessToken}` }
            });
            userGuilds = guildsRes.data || [];
            console.log(`Successfully fetched ${userGuilds.length} guilds for user ${user.username}`);
        } catch (e) {
            console.error(`Failed to fetch user guilds for ${user.username}:`, e.response?.data || e.message);
            // If token expired, we need to tell the user
            if (e.response?.status === 401) {
                return res.status(401).json({ error: 'Discord session expired. Please log out and log back in.' });
            }
            return res.status(500).json({ error: 'Failed to communicate with Discord API: ' + e.message });
        }

        // Fetch Bot Guilds to check presence
        let botGuildIds = new Set();
        const botToken = process.env.DISCORD_BOT_TOKEN;
        
        if (botToken && botToken !== 'YOUR_BOT_TOKEN_HERE' && botToken.length > 20) {
            try {
                const botGuildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
                    headers: { Authorization: `Bot ${botToken}` }
                });
                if (Array.isArray(botGuildsRes.data)) {
                    botGuildIds = new Set(botGuildsRes.data.map(g => g.id));
                    console.log(`Bot is currently in ${botGuildIds.size} guilds.`);
                }
            } catch (botErr) {
                console.error("Bot token error (Check Bot > Token in Developer Portal):", botErr.response?.data || botErr.message);
            }
        }

        // 0x20 is MANAGE_GUILD permission. User must have this to manage the bot on that server.
        const MANAGE_GUILD = 0x20n;
        const adminGuilds = userGuilds.filter(g => {
            try {
                if (!g.permissions) return false;
                // Some older guilds might have permissions as strings, some as numbers
                const userPerms = BigInt(g.permissions);
                return (userPerms & MANAGE_GUILD) === MANAGE_GUILD;
            } catch (e) {
                // Safeguard against BigInt errors or malformed data
                console.warn(`Permission parsing error for guild ${g.id}:`, e.message);
                return false;
            }
        });

        console.log(`User has Manage Server permissions in ${adminGuilds.length} guilds.`);

        const guildIds = adminGuilds.map(g => g.id);
        const dbConfigs = await Server.find({ discordGuildId: { $in: guildIds } });
        const configMap = {};
        dbConfigs.forEach(conf => { configMap[conf.discordGuildId] = conf; });

        const servers = adminGuilds.map(g => {
            const conf = configMap[g.id];
            const botInGuild = botGuildIds.has(g.id);
            
            // Safe decryption
            let decryptedKey = '';
            if (conf && conf.robloxApiKey) {
                const result = decrypt(conf.robloxApiKey);
                // If result is null, decryption failed (key mismatch), leave it empty
                if (result) decryptedKey = result;
            }

            return {
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
                connected: !!conf && !!conf.robloxApiKey && !!conf.robloxUniverseId,
                botInGuild: botInGuild,
                config: conf ? { 
                    universeId: conf.robloxUniverseId || '', 
                    adminRoleId: conf.adminRoleId || '', 
                    apiKey: decryptedKey
                } : null
            };
        });

        // Sort: Bot in guild first, then linked first, then name
        servers.sort((a, b) => {
            if (a.botInGuild !== b.botInGuild) return a.botInGuild ? -1 : 1;
            if (a.connected !== b.connected) return a.connected ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        
        res.json(servers);
    } catch (err) {
        // Log the actual error for Vercel/Console logs
        console.error("Critical API Error in /api/servers:", err);
        // Send actual error message to client for debugging
        res.status(500).json({ error: 'Server Error: ' + err.message });
    }
}));

app.post('/api/servers/:id/config', withDB(async (req, res) => {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { universeId, apiKey, adminRoleId } = req.body;
    
    try {
        const encryptedKey = apiKey ? encrypt(apiKey) : '';
        await Server.findOneAndUpdate(
            { discordGuildId: id },
            { 
                ownerDiscordId: req.session.userId, 
                robloxUniverseId: universeId, 
                robloxApiKey: encryptedKey, 
                adminRoleId: adminRoleId, 
                updatedAt: new Date() 
            },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save config: ' + err.message });
    }
}));

// Only run the server (and bot) if executed directly (e.g. node index.js)
// This prevents the bot from starting in Vercel Serverless environment
if (require.main === module) {
    const PORT = process.env.PORT || 3001;
    
    // Start Express Server
    app.listen(PORT, async () => {
        console.log(`🚀 Backend running on port ${PORT}`);
        
        // Ensure DB is connected before starting bot
        try {
            await connectDB();
            console.log("✅ Database Connected");
            
            // Start the Bot
            console.log("🔄 Starting Discord Bot...");
            await startBot();
        } catch (e) {
            console.error("❌ Failed to initialize backend resources:", e);
        }
    });
}

module.exports = app;