const startBot = async () => {
    const token = process.env.DISCORD_BOT_TOKEN;
    
    // Enhanced debug logging
    console.log('\n========================================');
    console.log('🔍 DISCORD BOT INITIALIZATION DEBUG');
    console.log('========================================');
    console.log('Environment:', process.env.NODE_ENV || 'development');
    console.log('Bot Token Check:');
    console.log('  - Token exists:', !!token);
    console.log('  - Token length:', token ? token.length : 0);
    console.log('  - Token preview:', token ? token.substring(0, 10) + '...' : 'N/A');
    // FIXED: More lenient token validation - just check it has 3 parts
    console.log('  - Token format valid:', token ? token.split('.').length === 3 : false);
    
    if (!token || token === 'YOUR_BOT_TOKEN_HERE' || token.length < 50) {
        console.error("\n❌ CRITICAL: Invalid or missing Discord Bot Token");
        console.error("❌ Token must be at least 50 characters");
        console.error("❌ Please set DISCORD_BOT_TOKEN in your environment variables");
        console.error("❌ Get your token from: https://discord.com/developers/applications");
        console.error('========================================\n');
        return;
    }

    console.log('✅ Bot token validated');
    console.log('========================================\n');
    
    console.log('🔧 Creating Discord client with intents...');
    const client = new Client({ 
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMembers  // ADDED: This is required!
        ]
    });

    // Comprehensive error handling
    client.on('error', error => {
        console.error('\n❌ DISCORD CLIENT ERROR:');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Stack trace:', error.stack);
        console.error('');
    });

    client.on('warn', info => {
        console.warn('⚠️ Discord Client Warning:', info);
    });

    client.on('debug', info => {
        // Log ALL debug messages for troubleshooting
        console.log('🔧 Debug:', info);
    });

    client.on('shardError', error => {
        console.error('\n❌ WEBSOCKET SHARD ERROR:');
        console.error('Error:', error);
        console.error('Error code:', error.code);
        console.error('');
    });

    client.on('shardReady', (id) => {
        console.log(`✅ Shard ${id} is ready and connected!`);
    });

    client.on('shardDisconnect', (event, id) => {
        console.warn(`⚠️ Shard ${id} disconnected:`, event);
    });

    client.on('shardReconnecting', (id) => {
        console.log(`🔄 Shard ${id} is reconnecting...`);
    });

    client.on('shardResume', (id) => {
        console.log(`✅ Shard ${id} resumed connection`);
    });

    client.once('ready', async () => {
        console.log('\n========================================');
        console.log('🤖 DISCORD BOT READY');
        console.log('========================================');
        console.log('Bot User:', client.user.tag);
        console.log('Bot ID:', client.user.id);
        console.log('Connected to servers:', client.guilds.cache.size);
        
        if (client.guilds.cache.size === 0) {
            console.warn('\n⚠️ WARNING: Bot is not in any Discord servers!');
            console.warn('⚠️ Invite your bot using this URL:');
            console.warn(`⚠️ https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`);
        } else {
            console.log('\nServers:');
            client.guilds.cache.forEach(guild => {
                console.log(`  - ${guild.name} (${guild.id}) - ${guild.memberCount} members`);
            });
        }
        console.log('========================================\n');

        // Register Commands
        const rest = new REST({ version: '10' }).setToken(token);
        try {
            console.log('🔄 Registering slash commands...');
            console.log(`   Commands to register: ${commands.length}`);
            
            const data = await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands },
            );
            
            console.log(`✅ Successfully registered ${data.length} application commands`);
            data.forEach(cmd => {
                console.log(`   - /${cmd.name}: ${cmd.description}`);
            });
        } catch (error) {
            console.error('❌ Failed to register commands:');
            console.error('Error:', error.message);
            if (error.response) {
                console.error('Response:', error.response.data);
            }
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        console.log(`\n📥 Command received: /${interaction.commandName} from ${interaction.user.tag} in ${interaction.guild?.name}`);

        await interaction.deferReply();

        try {
            // 1. Fetch Server Config
            console.log(`🔍 Fetching config for guild: ${interaction.guildId}`);
            const config = await Server.findOne({ discordGuildId: interaction.guildId });

            if (!config || !config.robloxApiKey || !config.robloxUniverseId) {
                console.warn('⚠️ Server not configured');
                return interaction.editReply({ 
                    content: '❌ **Setup Required:** This server is not connected to RobloxSync. Please configure it in the dashboard at your Render URL.' 
                });
            }

            console.log('✅ Server config found');
            console.log(`   Universe ID: ${config.robloxUniverseId}`);
            console.log(`   Admin Role: ${config.adminRoleId || 'None set'}`);

            // 2. Check Permissions (Admin Role)
            if (config.adminRoleId) {
                const hasRole = interaction.member.roles.cache.has(config.adminRoleId);
                const isAdmin = interaction.member.permissions.has('Administrator');
                
                console.log(`🔐 Permission check:`);
                console.log(`   Has admin role: ${hasRole}`);
                console.log(`   Is administrator: ${isAdmin}`);
                
                if (!hasRole && !isAdmin) {
                    console.warn('⛔ Permission denied');
                    return interaction.editReply({ 
                        content: `⛔ **Permission Denied:** You need the <@&${config.adminRoleId}> role or Administrator permission to use this command.` 
                    });
                }
            }

            console.log('✅ Permission check passed');

            // 3. Decrypt API Key
            const apiKey = decrypt(config.robloxApiKey);
            if (!apiKey) {
                console.error('❌ API Key decryption failed');
                return interaction.editReply({ 
                    content: '❌ **Error:** API Key decryption failed. Please update your settings in the dashboard.' 
                });
            }

            console.log('✅ API Key decrypted successfully');

            // 4. Prepare Command Data
            const commandName = interaction.commandName;
            const userId = interaction.options.getString('userid');
            const reason = interaction.options.getString('reason') || 'No reason provided';
            const message = interaction.options.getString('message');
            const moderator = `${interaction.user.tag} (${interaction.user.id})`;

            let payload = {};
            let successMsg = '';

            // 5. Construct Payload based on command
            switch (commandName) {
                case 'robloxban':
                    payload = { action: 'ban', userId, reason, moderator };
                    successMsg = `✅ **Banned** User \`${userId}\`\n**Reason:** ${reason}\n**Moderator:** ${interaction.user.tag}`;
                    break;
                
                case 'robloxkick':
                    payload = { action: 'kick', userId, reason, moderator };
                    successMsg = `⚽ **Kicked** User \`${userId}\`\n**Reason:** ${reason}\n**Moderator:** ${interaction.user.tag}`;
                    break;
                
                case 'robloxunban':
                    payload = { action: 'unban', userId, moderator };
                    successMsg = `🔓 **Unbanned** User \`${userId}\`\n**Moderator:** ${interaction.user.tag}`;
                    break;
                
                case 'robloxannounce':
                    payload = { action: 'announce', message, moderator };
                    successMsg = `📢 **Announcement Sent**\n**Message:** "${message}"\n**Moderator:** ${interaction.user.tag}`;
                    break;
                
                default:
                    console.error('❌ Unknown command:', commandName);
                    return interaction.editReply({ content: '❌ Unknown command' });
            }

            // 6. Send to Roblox
            console.log('📤 Sending command to Roblox...');
            await publishToRoblox(config.robloxUniverseId, apiKey, payload);

            // 7. Log Success
            console.log('✅ Command executed successfully\n');
            await interaction.editReply({ content: successMsg });

        } catch (error) {
            console.error('\n❌ COMMAND EXECUTION ERROR:');
            console.error('Command:', interaction.commandName);
            console.error('User:', interaction.user.tag);
            console.error('Error:', error.message);
            console.error('Stack:', error.stack);
            console.error('');
            
            await interaction.editReply({ 
                content: `❌ **Error:** ${error.message}\n\nPlease check the bot logs or contact an administrator.` 
            }).catch(err => {
                console.error('Failed to send error message:', err);
            });
        }
    });

    console.log('🔄 Attempting to login to Discord...');
    console.log('   This may take 10-30 seconds...\n');
    
    try {
        await client.login(token);
        console.log('✅ Login method called successfully (waiting for READY event)');
    } catch (err) {
        console.error('\n========================================');
        console.error('❌ FATAL: BOT LOGIN FAILED');
        console.error('========================================');
        console.error('Error code:', err.code);
        console.error('Error message:', err.message);
        console.error('Full error:', err.stack);
        console.error('\nCommon causes:');
        console.error('  - Invalid token format');
        console.error('  - Token has been reset/regenerated');
        console.error('  - Bot application has been deleted');
        console.error('  - Network/firewall blocking Discord');
        console.error('========================================\n');
        throw err;
    }
};