require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const { startBot } = require('./Bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoints (no website needed - just status checks)
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
        
        // Connect to MongoDB
        if (process.env.MONGODB_URI) {
            await mongoose.connect(process.env.MONGODB_URI);
            console.log('✅ MongoDB Connected');
        } else {
            console.warn('⚠️  MONGODB_URI not set. Database features will not work.');
        }

        // Start Discord Bot
        await startBot();

        // Start Express server for health checks
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Health check server running on port ${PORT}`);
        });
        
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