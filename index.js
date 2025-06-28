require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const GROUPS_FILE = 'groups.json';
const LAST_MESSAGES_FILE = 'last_messages.json';

const token = process.env.BOT_TOKEN;
const ownerIds = process.env.OWNER_IDS
  ? process.env.OWNER_IDS.split(',').map(id => id.trim())
  : [];

const bot = new TelegramBot(token, { polling: true });

let groupIds = fs.existsSync(GROUPS_FILE)
  ? JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'))
  : [];

let lastMessages = fs.existsSync(LAST_MESSAGES_FILE)
  ? JSON.parse(fs.readFileSync(LAST_MESSAGES_FILE, 'utf8'))
  : {};

const processedMessages = new Set();
const mediaGroups = {};

const debounce = (func, delay) => {
  const timers = {};
  return (key, ...args) => {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => func(...args), delay);
  };
};

const sendMediaGroupDebounced = debounce(async (id) => {
  const groupMedia = mediaGroups[id];
  if (!groupMedia || groupMedia.length === 0) return;

  for (const group of groupIds) {
    try {
      const sent = await bot.sendMediaGroup(group.id, groupMedia);
      lastMessages[group.id] = sent[0].message_id;
    } catch (err) {
      console.error(`❌ Media group xatolik (${group.id}):`, err.message);
    }
  }

  fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(lastMessages, null, 2));
  for (const adminId of ownerIds) {
    await bot.sendMessage(adminId, `📷 ${groupMedia.length} ta albom ${groupIds.length} ta guruhga yuborildi.`);
  }
  delete mediaGroups[id];
}, 2000);

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (msg.chat.type === 'private' && !ownerIds.includes(String(msg.from.id))) {
  return bot.sendMessage(chatId, "Sizda botni boshqarish huquqi yo'q.");
}

  if (processedMessages.has(msg.message_id)) return;
  processedMessages.add(msg.message_id);

  // /start
  if (msg.text === '/start' && msg.chat.type === 'private') {
    const keyboard = {
      keyboard: [
        [{ text: "Guruhlar ro'yxati" }],
        [{ text: "Oxirgi xabarni o'chirish" }]
      ],
      resize_keyboard: true
    };
    return bot.sendMessage(chatId, 'Botga xush kelibsiz!', { reply_markup: keyboard });
  }

  // "Guruhlar ro'yxati" tugmasi
  if (msg.chat.type === 'private' && msg.text === "Guruhlar ro'yxati") {
    if (!groupIds.length) {
      return bot.sendMessage(chatId, "Bot hech qanday guruhga qo'shilmagan.");
    }

    let updatedGroupIds = [];
    let availableGroups = [];

    for (const group of groupIds) {
      try {
        await bot.getChat(group.id);
        updatedGroupIds.push(group);
        availableGroups.push(group);
      } catch (err) {
        console.warn(`❌ Guruhdan chiqarilgan: ${group.name} (${group.id})`);
      }
    }

    if (updatedGroupIds.length !== groupIds.length) {
      groupIds = updatedGroupIds;
      fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupIds, null, 2));
    }

    if (!availableGroups.length) {
      return bot.sendMessage(chatId, "Bot hech qanday guruhda qolmagan.");
    }

    const groupList = availableGroups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
    return bot.sendMessage(chatId, `📋 Bot quyidagi guruhlarda mavjud:\n${groupList}`);
  }

  // /groups - file yuborish
  if (msg.chat.type === 'private' && msg.text === '/groups') {
    if (fs.existsSync(GROUPS_FILE)) {
      return bot.sendDocument(chatId, GROUPS_FILE, {}, {
        filename: 'groups.json',
        contentType: 'application/json'
      });
    } else {
      return bot.sendMessage(chatId, "groups.json fayli topilmadi.");
    }
  }

  // Guruhga qo‘shilganda
  if (['group', 'supergroup'].includes(msg.chat.type)) {
    if (!groupIds.find(g => g.id === chatId)) {
      groupIds.push({ id: chatId, name: msg.chat.title || 'No name' });
      fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupIds, null, 2));
    }
  }

  // "Oxirgi xabarni o'chirish" tugmasi
  if (msg.chat.type === 'private' && msg.text === "Oxirgi xabarni o'chirish") {
    let deleted = 0;
    for (const group of groupIds) {
      const mid = lastMessages[group.id];
      if (mid) {
        try {
          await bot.deleteMessage(group.id, mid);
          deleted++;
        } catch (e) {
          console.error(`❌ Delete error (${group.id}):`, e.message);
        }
      }
    }
    return bot.sendMessage(chatId, `${deleted} ta guruhda oxirgi xabar o'chirildi.`);
  }

  // MediaGroup (album)
  if (msg.media_group_id && msg.photo && msg.chat.type === 'private') {
    const id = msg.media_group_id;
    if (!mediaGroups[id]) mediaGroups[id] = [];

    mediaGroups[id].push({
      type: 'photo',
      media: msg.photo[msg.photo.length - 1].file_id,
      caption: msg.caption || '',
      parse_mode: 'HTML'
    });

    sendMediaGroupDebounced(id, id);
    return;
  }

  // Video
  if (msg.video && msg.chat.type === 'private') {
    let count = 0;
    const video = msg.video.file_id;
    const caption = msg.caption || '';
    for (const group of groupIds) {
      try {
        const sent = await bot.sendVideo(group.id, video, { caption });
        lastMessages[group.id] = sent.message_id;
        count++;
      } catch (e) {
        console.error(`❌ Video xatolik (${group.id}):`, e.message);
      }
    }
    fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(lastMessages, null, 2));
    return bot.sendMessage(chatId, `📹 Videongiz ${count} ta guruhga yuborildi.`);
  }

  // Yakka rasm
  if (msg.photo && !msg.media_group_id && msg.chat.type === 'private') {
    let count = 0;
    const photo = msg.photo[msg.photo.length - 1].file_id;
    const caption = msg.caption || '';
    for (const group of groupIds) {
      try {
        const sent = await bot.sendPhoto(group.id, photo, { caption });
        lastMessages[group.id] = sent.message_id;
        count++;
      } catch (e) {
        console.error(`❌ Rasm xatolik (${group.id}):`, e.message);
      }
    }
    fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(lastMessages, null, 2));
    return bot.sendMessage(chatId, `📸 Fotosuratingiz ${count} ta guruhga yuborildi.`);
  }

  // Matn
  if (msg.text && msg.chat.type === 'private' && !msg.text.startsWith('/')) {
    let count = 0;
    for (const group of groupIds) {
      try {
        const sent = await bot.sendMessage(group.id, msg.text);
        lastMessages[group.id] = sent.message_id;
        count++;
      } catch (e) {
        console.error(`❌ Matn xatolik (${group.id}):`, e.message);
      }
    }
    fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(lastMessages, null, 2));
    return bot.sendMessage(chatId, `📨 Xabaringiz ${count} ta guruhga yuborildi.`);
  }

  // /delete_last buyrug‘i
  if (msg.text === '/delete_last' && msg.chat.type === 'private') {
    let deleted = 0;
    for (const group of groupIds) {
      const mid = lastMessages[group.id];
      if (mid) {
        try {
          await bot.deleteMessage(group.id, mid);
          deleted++;
        } catch (e) {
          console.error(`❌ Delete error (${group.id}):`, e.message);
        }
      }
    }
    return bot.sendMessage(chatId, `${deleted} ta guruhda oxirgi xabar o'chirildi.`);
  }
});
