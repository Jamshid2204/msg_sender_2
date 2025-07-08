const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  message: {
    type: {
      type: String,
      enum: ['text', 'photo', 'video', 'media_group'],
      required: true
    },
    data: mongoose.Schema.Types.Mixed,
    caption: String
  },
  groups: [Number]
});

module.exports = mongoose.model('PendingMessage', schema);
