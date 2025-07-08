const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true }
});

module.exports = mongoose.model('Group', groupSchema);
