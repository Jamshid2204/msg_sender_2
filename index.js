require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const GROUPS_FILE = 'groups2.json';
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
const userSessions = {}; // userId -> { message, selectedGroups }

function generateGroupKeyboard(selectedIds = []) {
  const buttons = groupIds.map(group => [{
    text: `${selectedIds.includes(group.id) ? '✅' : '☑️'} ${group.name}`,
    callback_data: `toggle_${group.id}`
  }]);
  buttons.push([
    { text: '📤 Barchasiga', callback_data: 'send_all' },
    { text: '🚀 Yuborish', callback_data: 'send_message' }
  ]);
  return { inline_keyboard: buttons };
}

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

  const session = userSessions[id];
  const targetGroups = session?.selectedGroups || groupIds;

  for (const group of targetGroups) {
    try {
      const sent = await bot.sendMediaGroup(group.id, groupMedia);
      lastMessages[group.id] = sent[0].message_id;
    } catch (err) {
      console.error(`❌ Media group xatolik (${group.id}):`, err.message);
    }
  }

  fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(lastMessages, null, 2));
  for (const adminId of ownerIds) {
    await bot.sendMessage(adminId, `📷 ${groupMedia.length} ta albom ${targetGroups.length} ta guruhga yuborildi.`);
  }
  delete mediaGroups[id];
}, 2000);

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (msg.chat.type === 'private' && !ownerIds.includes(String(userId))) {
    return bot.sendMessage(chatId, "Sizda botni boshqarish huquqi yo'q.");
  }

  if (processedMessages.has(msg.message_id)) return;
  processedMessages.add(msg.message_id);

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

    // 🆕 /ping qo‘shish — guruhdan kelgan bo‘lsa
  if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && msg.text === '/ping') {
    if (!groupIds.find(g => g.id === msg.chat.id)) {
      groupIds.push({ id: msg.chat.id, name: msg.chat.title || 'No name' });
      fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupIds, null, 2));
      return bot.sendMessage(msg.chat.id, "✅ Bu guruh ro'yxatga qo‘shildi.");
    } else {
      return bot.sendMessage(msg.chat.id, "✅ Bu guruh allaqachon ro'yxatda mavjud.");
    }
  }

  if (['group', 'supergroup'].includes(msg.chat.type)) {
    if (!groupIds.find(g => g.id === chatId)) {
      groupIds.push({ id: chatId, name: msg.chat.title || 'No name' });
      fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupIds, null, 2));
    }
  }

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

  if (msg.media_group_id && msg.photo && msg.chat.type === 'private') {
    const id = msg.media_group_id;
    if (!mediaGroups[id]) mediaGroups[id] = [];

    mediaGroups[id].push({
      type: 'photo',
      media: msg.photo[msg.photo.length - 1].file_id,
      caption: msg.caption || '',
      parse_mode: 'HTML'
    });

    userSessions[id] = { message: msg, selectedGroups: [] };

    await bot.sendMessage(chatId, 'Qaysi guruhlarga yuborilsin?', {
      reply_markup: generateGroupKeyboard()
    });

    sendMediaGroupDebounced(id);
    return;
  }

  if (msg.video && msg.chat.type === 'private') {
    userSessions[userId] = { message: msg, selectedGroups: [] };

    await bot.sendMessage(chatId, 'Qaysi guruhlarga yuborilsin?', {
      reply_markup: generateGroupKeyboard()
    });
    return;
  }

  if (msg.photo && !msg.media_group_id && msg.chat.type === 'private') {
    userSessions[userId] = { message: msg, selectedGroups: [] };

    await bot.sendMessage(chatId, 'Qaysi guruhlarga yuborilsin?', {
      reply_markup: generateGroupKeyboard()
    });
    return;
  }

  if (msg.text && msg.chat.type === 'private' && !msg.text.startsWith('/')) {
    userSessions[userId] = { message: msg, selectedGroups: [] };

    await bot.sendMessage(chatId, 'Qaysi guruhlarga yuborilsin?', {
      reply_markup: generateGroupKeyboard()
    });
    return;
  }

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

bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const session = userSessions[userId] || userSessions[query.message.message_id];
  if (!session) return;

  const data = query.data;

  if (data.startsWith('toggle_')) {
    const groupId = parseInt(data.split('_')[1]);
    const index = session.selectedGroups.indexOf(groupId);
    if (index > -1) {
      session.selectedGroups.splice(index, 1);
    } else {
      session.selectedGroups.push(groupId);
    }

    await bot.editMessageReplyMarkup(
      generateGroupKeyboard(session.selectedGroups),
      { chat_id: query.message.chat.id, message_id: query.message.message_id }
    );
    return bot.answerCallbackQuery(query.id);
  }

  if (data === 'send_all') {
    session.selectedGroups = groupIds.map(g => g.id);
    await bot.editMessageReplyMarkup(
      generateGroupKeyboard(session.selectedGroups),
      { chat_id: query.message.chat.id, message_id: query.message.message_id }
    );
    return bot.answerCallbackQuery(query.id, { text: 'Barcha guruhlar tanlandi' });
  }

  if (data === 'send_message') {
    const selectedGroups = session.selectedGroups;
    const { message } = session;

    for (const groupId of selectedGroups) {
      try {
        if (message.photo) {
          const photo = message.photo[message.photo.length - 1].file_id;
          const sent = await bot.sendPhoto(groupId, photo, { caption: message.caption });
          lastMessages[groupId] = sent.message_id;
        } else if (message.video) {
          const sent = await bot.sendVideo(groupId, message.video.file_id, { caption: message.caption });
          lastMessages[groupId] = sent.message_id;
        } else if (message.text) {
          const sent = await bot.sendMessage(groupId, message.text);
          lastMessages[groupId] = sent.message_id;
        }
      } catch (e) {
        console.error(`❌ Xatolik (${groupId}):`, e.message);
      }
    }

    fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(lastMessages, null, 2));
    delete userSessions[userId];

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    });
    return bot.sendMessage(userId, '✅ Xabar yuborildi.');
  }
});
