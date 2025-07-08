const mongoose = require('mongoose');

const sentMessageSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  groupId: { type: Number, required: true },
  type: { type: String, required: true }, // text, photo, video, media_group
  content: mongoose.Schema.Types.Mixed,   // could be text or file_id
  caption: String,
  sentAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SentMessage', sentMessageSchema);
