require('dotenv').config();
const mongoose = require('mongoose');
const { startBot } = require('./Bot');

const startApp = async () => {
    try {
        console.log('🚀 Starting RobloxSync Bot...');
        
        // Connect to MongoDB
        if (process.env.MONGODB_URI) {
            await mongoose.connect(process.env.MONGODB_URI);
            console.log('✅ MongoDB Connected');
        } else {
            console.warn('⚠️  MONGODB_URI not set. Database features will not work.');
            console.warn('⚠️  Please set MONGODB_URI in your environment variables.');
        }

        // Start Discord Bot
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