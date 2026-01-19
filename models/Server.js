const mongoose = require('mongoose');

const ServerSchema = new mongoose.Schema({
  discordGuildId: { type: String, required: true, unique: true },
  ownerDiscordId: { type: String, required: true },
  robloxUniverseId: { type: String },
  robloxApiKey: { type: String }, // Encrypted
  adminRoleId: { type: String },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Server || mongoose.model('Server', ServerSchema);