const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  username: String,
  first_name: String,
  last_name: String,
  is_bot: Boolean,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
