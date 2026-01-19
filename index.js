require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const { startBot } = require('./Bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Debug: Log environment variables (without exposing values)
console.log('🔍 Environment Check:');
console.log('- DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN ? '✅ Set' : '❌ Missing');
console.log('- MONGODB_URI:', process.env.MONGODB_URI ? '✅ Set' : '❌ Missing');
console.log('- ENCRYPTION_KEY:', process.env.ENCRYPTION_KEY ? '✅ Set' : '❌ Missing');

// Health check endpoints
app.get('/', (req, res) => {
    res.send('✅ RobloxSync Bot is running!');
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

const startApp = async () => {
    try {
        console.log('🚀 Starting RobloxSync Bot...');
        
        // 1. Start Express server FIRST (so Render detects the port)
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Health check server running on port ${PORT}`);
        });

        // 2. Connect to MongoDB
        if (process.env.MONGODB_URI) {
            await mongoose.connect(process.env.MONGODB_URI);
            console.log('✅ MongoDB Connected');
        } else {
            console.warn('⚠️  MONGODB_URI not set. Database features will not work.');
        }

        // 3. Start Discord Bot (after Express is running)
        await startBot();
        
    } catch (error) {
        console.error('❌ Startup Error:', error);
        process.exit(1);
    }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

startApp();