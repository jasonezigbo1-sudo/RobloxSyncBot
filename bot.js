const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionsBitField
} = require('discord.js');

const axios = require('axios');
const Server = require('./models/Server');
const { decrypt } = require('./utils/crypto');

/* ---------------- COMMANDS ---------------- */
const commands = [
    new SlashCommandBuilder()
        .setName('robloxban')
        .setDescription('Ban a user from the Roblox game')
        .addStringOption(o =>
            o.setName('userid').setDescription('Roblox User ID').setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('robloxkick')
        .setDescription('Kick a user from the Roblox game')
        .addStringOption(o =>
            o.setName('userid').setDescription('Roblox User ID').setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
        .setName('robloxunban')
        .setDescription('Unban a user from the Roblox game')
        .addStringOption(o =>
            o.setName('userid').setDescription('Roblox User ID').setRequired(true)),

    new SlashCommandBuilder()
        .setName('robloxannounce')
        .setDescription('Send a global announcement')
        .addStringOption(o =>
            o.setName('message').setDescription('Message').setRequired(true))
].map(c => c.toJSON());

/* ---------------- ROBLOX PUBLISH ---------------- */
async function publishToRoblox(universeId, apiKey, payload) {
    const url = `https://apis.roblox.com/messaging-service/v1/universes/${universeId}/topics/DiscordBanCommand`;

    await axios.post(
        url,
        { message: JSON.stringify(payload) },
        {
            headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        }
    );
}

/* ---------------- BOT ---------------- */
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const botGuildIds = new Set();

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    client.guilds.cache.forEach(g => botGuildIds.add(g.id));

    const rest = new REST({ version: '10' })
        .setToken(process.env.DISCORD_BOT_TOKEN);

    console.log('🔄 Registering slash commands...');
    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );
    console.log('✅ Slash commands registered');
});

client.on('guildCreate', g => botGuildIds.add(g.id));
client.on('guildDelete', g => botGuildIds.delete(g.id));

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (!interaction.guild) {
        return interaction.reply({
            content: '❌ Commands must be used in a server.',
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const config = await Server.findOne({
            discordGuildId: interaction.guildId
        });

        if (!config || !config.robloxApiKey || !config.robloxUniverseId) {
            return interaction.editReply(
                '❌ This server is not configured.'
            );
        }

        if (config.adminRoleId) {
            const hasRole = interaction.member.roles.cache.has(config.adminRoleId);
            const isAdmin = interaction.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            );

            if (!hasRole && !isAdmin) {
                return interaction.editReply(
                    '⛔ You do not have permission to use this command.'
                );
            }
        }

        const apiKey = decrypt(config.robloxApiKey);
        if (!apiKey) {
            return interaction.editReply(
                '❌ API key decryption failed.'
            );
        }

        const userId = interaction.options.getString('userid');
        const reason = interaction.options.getString('reason') || 'No reason';
        const message = interaction.options.getString('message');
        const moderator = `${interaction.user.tag} (${interaction.user.id})`;

        let payload, response;

        switch (interaction.commandName) {
            case 'robloxban':
                payload = { action: 'ban', userId, reason, moderator };
                response = `✅ Banned \`${userId}\``;
                break;
            case 'robloxkick':
                payload = { action: 'kick', userId, reason, moderator };
                response = `⚽ Kicked \`${userId}\``;
                break;
            case 'robloxunban':
                payload = { action: 'unban', userId, moderator };
                response = `🔓 Unbanned \`${userId}\``;
                break;
            case 'robloxannounce':
                payload = { action: 'announce', message, moderator };
                response = `📢 Announcement sent`;
                break;
            default:
                return interaction.editReply('❌ Unknown command');
        }

        await publishToRoblox(
            config.robloxUniverseId,
            apiKey,
            payload
        );

        await interaction.editReply(response);
    } catch (err) {
        console.error(err);
        await interaction.editReply(`❌ Error: ${err.message}`);
    }
});

async function startBot() {
    await client.login(process.env.DISCORD_BOT_TOKEN);
}

function getBotGuildIds() {
    return botGuildIds;
}

module.exports = { startBot, getBotGuildIds };
