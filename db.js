const mongoose = require('mongoose');

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ MongoDB ulanish muvaffaqiyatli');
    } catch (err) {
        console.error('❌ MongoDB ulanishda xatolik:', err.message);
        process.exit(1);
    }
}

module.exports = connectDB;
