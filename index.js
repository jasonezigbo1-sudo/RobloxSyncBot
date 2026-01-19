require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieSession = require('cookie-session');
const axios = require('axios');

const connectDB = require('./lib/mongodb');
const User = require('./models/User');
const Server = require('./models/Server');
const { encrypt, decrypt } = require('./utils/crypto');
const { startBot, getBotGuildIds } = require('./bot');

const app = express();
app.set('trust proxy', 1);

/* ---------- CORS (RENDER SAFE) ---------- */
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}));

/* ---------- BODY ---------- */
app.use(express.json());

/* ---------- COOKIES (RENDER SAFE) ---------- */
app.use(cookieSession({
    name: 'robloxsync_session',
    keys: [process.env.SESSION_SECRET],
    maxAge: 24 * 60 * 60 * 1000,
    secure: true,
    sameSite: 'none',
    httpOnly: true
}));

/* ---------- DB SINGLE CONNECTION ---------- */
let dbReady = false;
async function ensureDB() {
    if (!dbReady) {
        await connectDB();
        dbReady = true;
        console.log('✅ MongoDB connected');
    }
}

const withDB = (handler) => async (req, res) => {
    try {
        await ensureDB();
        return handler(req, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Database error' });
    }
};

/* ---------- HEALTH ---------- */
app.get('/api/health', (_, res) => {
    res.json({ ok: true });
});

/* ---------- CONFIG ---------- */
app.get('/api/config', (_, res) => {
    res.json({
        clientId: process.env.DISCORD_CLIENT_ID,
        redirectUri: process.env.DISCORD_REDIRECT_URI,
        isBotConfigured: !!process.env.DISCORD_BOT_TOKEN
    });
});

/* ---------- AUTH ---------- */
app.get('/api/auth/login', (req, res) => {
    const scopes = 'identify guilds';
    const url =
        `https://discord.com/api/oauth2/authorize` +
        `?client_id=${process.env.DISCORD_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}`;
    res.redirect(url);
});

app.get('/api/auth/discord/callback', withDB(async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code');

    const tokenRes = await axios.post(
        'https://discord.com/api/oauth2/token',
        new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token } = tokenRes.data;

    const userRes = await axios.get(
        'https://discord.com/api/users/@me',
        { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const { id, username, avatar } = userRes.data;

    await User.findOneAndUpdate(
        { discordId: id },
        {
            username,
            avatar: avatar
                ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`
                : null,
            accessToken: encrypt(access_token),
            refreshToken: encrypt(refresh_token),
            lastLogin: new Date()
        },
        { upsert: true }
    );

    req.session.userId = id;
    res.redirect(`${process.env.FRONTEND_URL}/?dashboard=true`);
}));

app.get('/api/auth/logout', (req, res) => {
    req.session = null;
    res.json({ success: true });
});

/* ---------- USER ---------- */
app.get('/api/me', withDB(async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await User.findOne({ discordId: req.session.userId });
    if (!user) return res.status(401).json({ error: 'User not found' });

    res.json({
        id: user.discordId,
        username: user.username,
        avatar: user.avatar
    });
}));

/* ---------- SERVERS ---------- */
app.get('/api/servers', withDB(async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await User.findOne({ discordId: req.session.userId });
    const accessToken = decrypt(user.accessToken);

    const guildRes = await axios.get(
        'https://discord.com/api/users/@me/guilds',
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const MANAGE_GUILD = 0x20n;
    const adminGuilds = guildRes.data.filter(g => {
        try {
            return (BigInt(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD;
        } catch {
            return false;
        }
    });

    const botGuildIds = getBotGuildIds();
    const configs = await Server.find({
        discordGuildId: { $in: adminGuilds.map(g => g.id) }
    });

    const configMap = Object.fromEntries(
        configs.map(c => [c.discordGuildId, c])
    );

    res.json(adminGuilds.map(g => {
        const conf = configMap[g.id];
        return {
            id: g.id,
            name: g.name,
            icon: g.icon
                ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
                : null,
            botInGuild: botGuildIds.has(g.id),
            connected: !!conf,
            config: conf ? {
                universeId: conf.robloxUniverseId,
                adminRoleId: conf.adminRoleId,
                apiKey: decrypt(conf.robloxApiKey)
            } : null
        };
    }));
}));

/* ---------- SAVE CONFIG ---------- */
app.post('/api/servers/:id/config', withDB(async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });

    const { universeId, apiKey, adminRoleId } = req.body;

    await Server.findOneAndUpdate(
        { discordGuildId: req.params.id },
        {
            ownerDiscordId: req.session.userId,
            robloxUniverseId: universeId,
            robloxApiKey: encrypt(apiKey),
            adminRoleId,
            updatedAt: new Date()
        },
        { upsert: true }
    );

    res.json({ success: true });
}));

/* ---------- START ---------- */
if (require.main === module) {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, async () => {
        await ensureDB();
        await startBot();
        console.log(`🚀 Backend + Bot running on ${PORT}`);
    });
}

module.exports = app;
