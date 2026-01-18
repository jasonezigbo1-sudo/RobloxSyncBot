const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const Server = require('./server/models/Server'); // ✅ FIXED
const { decrypt } = require('./server/utils/crypto'); // ✅ FIXED

// Commands Definition
const commands = [
    new SlashCommandBuilder()
        .setName('robloxban')
        .setDescription('Ban a user from the Roblox game')
        .addStringOption(option => 
            option.setName('userid').setDescription('Roblox User ID').setRequired(true))
        .addStringOption(option => 
            option.setName('reason').setDescription('Reason for the ban').setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('robloxkick')
        .setDescription('Kick a user from the current server')
        .addStringOption(option => 
            option.setName('userid').setDescription('Roblox User ID').setRequired(true))
        .addStringOption(option => 
            option.setName('reason').setDescription('Reason for the kick').setRequired(false)),

    new SlashCommandBuilder()
        .setName('robloxunban')
        .setDescription('Unban a user from the Roblox game')
        .addStringOption(option => 
            option.setName('userid').setDescription('Roblox User ID').setRequired(true)),

    new SlashCommandBuilder()
        .setName('robloxannounce')
        .setDescription('Send a global announcement to all servers')
        .addStringOption(option => 
            option.setName('message').setDescription('Message to broadcast').setRequired(true))
]
.map(command => command.toJSON());

async function publishToRoblox(universeId, apiKey, payload) {
    const url = `https://apis.roblox.com/messaging-service/v1/universes/${universeId}/topics/DiscordBanCommand`;
    
    try {
        await axios.post(url, {
            message: JSON.stringify(payload)
        }, {
            headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json'
            }
        });
        return { success: true };
    } catch (error) {
        console.error("Roblox API Error:", error.response?.data || error.message);
        throw new Error(error.response?.data?.message || error.message);
    }
}

const startBot = async () => {
    const token = process.env.DISCORD_BOT_TOKEN;
    
    if (!token || token === 'YOUR_BOT_TOKEN_HERE' || token.length < 20) {
        console.warn("⚠️  Discord Bot Token not configured. Bot will not start.");
        return;
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once('ready', async () => {
        console.log(`🤖 Bot logged in as ${client.user.tag}`);

        // Register Commands
        const rest = new REST({ version: '10' }).setToken(token);
        try {
            console.log('Started refreshing application (/) commands.');
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands },
            );
            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error('Failed to register commands:', error);
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        await interaction.deferReply();

        try {
            // 1. Fetch Server Config
            const config = await Server.findOne({ discordGuildId: interaction.guildId });

            if (!config || !config.robloxApiKey || !config.robloxUniverseId) {
                return interaction.editReply({ 
                    content: '❌ **Setup Required:** This server is not connected to RobloxSync. Please configure it in the dashboard.' 
                });
            }

            // 2. Check Permissions (Admin Role)
            if (config.adminRoleId) {
                const hasRole = interaction.member.roles.cache.has(config.adminRoleId);
                // Check for Administrator permission as fallback
                const isAdmin = interaction.member.permissions.has('Administrator');
                
                if (!hasRole && !isAdmin) {
                    return interaction.editReply({ 
                        content: `⛔ **Permission Denied:** You need the <@&${config.adminRoleId}> role to use this command.` 
                    });
                }
            }

            // 3. Prepare Data
            const apiKey = decrypt(config.robloxApiKey);
            if (!apiKey) {
                return interaction.editReply({ content: '❌ **Error:** API Key decryption failed. Please update settings in dashboard.' });
            }

            const commandName = interaction.commandName;
            const userId = interaction.options.getString('userid');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const message = interaction.options.getString('message');
            const moderator = `${interaction.user.tag}`;

            let payload = {};
            let successMsg = '';

            // 4. Construct Payload based on command
            if (commandName === 'robloxban') {
                payload = { action: 'ban', userId, reason, moderator };
                successMsg = `✅ **Banned** User \`${userId}\`\n**Reason:** ${reason}`;
            } else if (commandName === 'robloxkick') {
                payload = { action: 'kick', userId, reason, moderator };
                successMsg = `⚽ **Kicked** User \`${userId}\`\n**Reason:** ${reason}`;
            } else if (commandName === 'robloxunban') {
                payload = { action: 'unban', userId, moderator };
                successMsg = `🔓 **Unbanned** User \`${userId}\``;
            } else if (commandName === 'robloxannounce') {
                payload = { action: 'announce', message, moderator };
                successMsg = `📢 **Announcement Sent:** "${message}"`;
            }

            // 5. Send to Roblox
            await publishToRoblox(config.robloxUniverseId, apiKey, payload);

            // 6. Log Success
            await interaction.editReply({ content: successMsg });

        } catch (error) {
            console.error('Command Error:', error);
            await interaction.editReply({ content: `❌ **Error:** ${error.message}` });
        }
    });

    try {
        await client.login(token);
    } catch (err) {
        console.error("Failed to login bot:", err.message);
    }
};

module.exports = { startBot };