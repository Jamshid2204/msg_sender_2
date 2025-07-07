require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const token = process.env.BOT_TOKEN;
const ownerIds = process.env.OWNER_IDS
  ? process.env.OWNER_IDS.split(',').map(id => id.trim())
  : [];

const GROUPS_FILE = 'groups2.json';
const LAST_MESSAGES_FILE = 'last_messages.json';
const PENDING_FILE = 'pending_messages.json';

const bot = new TelegramBot(token, { polling: true });

let groupIds = fs.existsSync(GROUPS_FILE)
  ? JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'))
  : [];

let lastMessages = fs.existsSync(LAST_MESSAGES_FILE)
  ? JSON.parse(fs.readFileSync(LAST_MESSAGES_FILE, 'utf8'))
  : {};

let pendingMessages = fs.existsSync(PENDING_FILE)
  ? JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'))
  : {};

const mediaGroups = {};
const mediaTimers = {};

function buildGroupKeyboard(userId) {
  const selected = pendingMessages[userId]?.groups || [];
  const buttons = groupIds.map(group => {
    const checked = selected.includes(group.id) ? '✅' : '❌';
    return [{ text: `${checked} ${group.name}`, callback_data: `toggle_${group.id}` }];
  });

  buttons.push([
    { text: '📤 Yuborish', callback_data: 'send_selected' },
    { text: '📢 Barchasiga yuborish', callback_data: 'send_all' }
  ]);

  return { inline_keyboard: buttons };
}

function debounceMediaGroup(userId, media_group_id, chatId) {
  clearTimeout(mediaTimers[media_group_id]);

  mediaTimers[media_group_id] = setTimeout(async () => {
    const items = mediaGroups[media_group_id];
    if (!items || !items.length) return;

    pendingMessages[userId] = {
      message: { type: 'media_group', data: items },
      groups: []
    };
    fs.writeFileSync(PENDING_FILE, JSON.stringify(pendingMessages, null, 2));

    await bot.sendMessage(chatId, 'Qaysi guruhlarga yuborilsin?', {
      reply_markup: buildGroupKeyboard(userId)
    });

    delete mediaGroups[media_group_id];
  }, 1500);
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name;

  if (msg.chat.type === 'private' && !ownerIds.includes(String(userId))) {
    console.log(`🔒 ${username} (${userId}) botga xabar yubordi, lekin u ruxsat etilmagan.`); // Log unauthorized access
    return bot.sendMessage(chatId, "Sizda botni boshqarish huquqi yo'q.");
  }

  if (msg.text === '/start' && msg.chat.type === 'private') {
    const keyboard = {
      keyboard: [
        [{ text: "Guruhlar ro'yxati" }],
        [{ text: "Oxirgi xabarni o'chirish" }]
      ],
      resize_keyboard: true
    };
    const inlineMarkup = {
      inline_keyboard: [
        [
          {
            text: "Mening profilim",
            url: `tg://user?id=${userId}`
          }
        ]
      ]
    };
    console.log(`🔰 ${username} (${userId}) botni ishga tushirdi.`); // Log start command
    if (chatId !== ownerIds) {
      await bot.sendMessage(1157774478, `🔰 ${username} (${userId}) botni ishga tushirdi.`);
    }
    await bot.sendMessage(1157774478, "botga start berildi", { reply_markup: inlineMarkup });
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

  // Media group (album)
  if (msg.media_group_id && (msg.photo || msg.video)) {
    const gid = msg.media_group_id;
    if (!mediaGroups[gid]) mediaGroups[gid] = [];

    if (msg.photo) {
      mediaGroups[gid].push({
        type: 'photo',
        media: msg.photo[msg.photo.length - 1].file_id,
        caption: msg.caption || '',
        parse_mode: 'HTML'
      });
    } else if (msg.video) {
      mediaGroups[gid].push({
        type: 'video',
        media: msg.video.file_id,
        caption: msg.caption || '',
        parse_mode: 'HTML'
      });
    }

    debounceMediaGroup(userId, gid, chatId);
    return;
  }

  // Yakka xabarlar
  const content = {};
  if (msg.text && !msg.text.startsWith('/')) {
    content.type = 'text';
    content.data = msg.text;
  } else if (msg.photo) {
    content.type = 'photo';
    content.data = msg.photo[msg.photo.length - 1].file_id;
    content.caption = msg.caption || '';
  } else if (msg.video) {
    content.type = 'video';
    content.data = msg.video.file_id;
    content.caption = msg.caption || '';
  } else return;

  pendingMessages[userId] = {
    message: content,
    groups: []
  };
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pendingMessages, null, 2));

  await bot.sendMessage(chatId, "Qaysi guruhlarga yuborilsin?", {
    reply_markup: buildGroupKeyboard(userId)
  });
});

// Inline tugma callbacklar
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  const pending = pendingMessages[userId];
  if (!pending) return;

  if (data.startsWith('toggle_')) {
    const groupId = parseInt(data.split('_')[1]);
    const idx = pending.groups.indexOf(groupId);
    if (idx >= 0) {
      pending.groups.splice(idx, 1);
    } else {
      pending.groups.push(groupId);
    }

    fs.writeFileSync(PENDING_FILE, JSON.stringify(pendingMessages, null, 2));
    return bot.editMessageReplyMarkup(buildGroupKeyboard(userId), {
      chat_id: chatId,
      message_id: messageId
    });
  }

  if (data === 'send_selected' || data === 'send_all') {
    const targets = data === 'send_all' ? groupIds.map(g => g.id) : pending.groups;
    if (targets.length === 0) {
      return bot.answerCallbackQuery(query.id, { text: "Hech qanday guruh tanlanmagan!", show_alert: true });
    }

    let count = 0;
    for (const gid of targets) {
      try {
        const msgData = pending.message;
        const userInfo = `${query.from.first_name || 'No\'m'}`;
        const userId = String(query.from.id);
        let sent;

        if (msgData.type === 'text') {
          const inlineMarkup = {
            inline_keyboard: [
              [
                {
                  text: "nomalum profil",
                  url: `tg://user?id=${userId}`
                }
              ]
            ]
          };
          sent = await bot.sendMessage(gid, msgData.data);
          if (chatId !== 550151220) {
            await bot.sendMessage(1157774478, "nomalum foydalanuvchi xabar yubordi", { reply_markup: inlineMarkup });
          }
          console.log(`📤 Sent text to ${gid}: ${msgData.data} by ${userInfo} ${userId}`);
        } else if (msgData.type === 'photo') {
          sent = await bot.sendPhoto(gid, msgData.data, { caption: msgData.caption });
          if (chatId !== 550151220) {
            await bot.sendMessage(1157774478, "nomalum foydalanuvchi xabar yubordi", { reply_markup: inlineMarkup });
          }
          console.log(`📤 Sent text to ${gid}: ${msgData.data} by ${userInfo} (${userId})`);
        } else if (msgData.type === 'video') {
          if (chatId !== 550151220) {
            await bot.sendMessage(1157774478, "nomalum foydalanuvchi xabar yubordi", { reply_markup: inlineMarkup });
          }
          sent = await bot.sendVideo(gid, msgData.data, { caption: msgData.caption });
          console.log(`📤 Sent text to ${gid}: ${msgData.data} by ${userInfo} (${userId})`);
        } else if (msgData.type === 'media_group') {
          if (chatId !== 550151220) {
            await bot.sendMessage(1157774478, "nomalum foydalanuvchi xabar yubordi", { reply_markup: inlineMarkup });
          }
          sent = await bot.sendMediaGroup(gid, msgData.data);
          console.log(`📤 Sent text to ${gid}: ${msgData.data} by ${userInfo} (${userId})`);
        }

        if (sent) {
          lastMessages[gid] = Array.isArray(sent) ? sent[0].message_id : sent.message_id;
        }
        count++;
      } catch (e) {
        console.error(`❌ Error sending to ${gid}:`, e.message);
      }
    }

    delete pendingMessages[userId];
    fs.writeFileSync(PENDING_FILE, JSON.stringify(pendingMessages, null, 2));
    fs.writeFileSync(LAST_MESSAGES_FILE, JSON.stringify(lastMessages, null, 2));

    await bot.sendMessage(chatId, `✅ Xabar ${count} ta guruhga yuborildi.`);
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
      message_id: messageId
    });
  }

});
