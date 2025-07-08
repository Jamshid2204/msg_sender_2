// index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const connectDB = require('./db');
const Group = require('./models/Group');
const User = require('./models/User');
const SentMessage = require('./models/SentMessage');
const PendingMessage = require('./models/PendingMessage');

connectDB();

const token = process.env.BOT_TOKEN;
const ownerIds = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(',') : [];

const bot = new TelegramBot(token, { polling: true });

const mediaGroups = {};
const mediaTimers = {};

async function getGroupList() {
  return await Group.find({});
}

async function buildGroupKeyboard(userId) {
  const groups = await getGroupList();
  const pending = await PendingMessage.findOne({ userId });
  const selected = pending?.groups || [];

  const buttons = groups.map(group => {
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

    await PendingMessage.findOneAndUpdate(
      { userId },
      {
        userId,
        message: { type: 'media_group', data: items },
        groups: []
      },
      { upsert: true }
    );

    await bot.sendMessage(chatId, 'Qaysi guruhlarga yuborilsin?', {
      reply_markup: await buildGroupKeyboard(userId)
    });

    delete mediaGroups[media_group_id];
  }, 1500);
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (msg.from) {
    await User.updateOne(
      { id: msg.from.id },
      {
        $set: {
          username: msg.from.username,
          first_name: msg.from.first_name,
          last_name: msg.from.last_name,
          is_bot: msg.from.is_bot
        }
      },
      { upsert: true }
    );
  }

  if (msg.chat.type === 'supergroup' || msg.chat.type === 'group') {
    const exists = await Group.findOne({ id: chatId });
    if (!exists) {
      await new Group({ id: chatId, name: msg.chat.title }).save();
      console.log(`➕ Yangi guruh: ${msg.chat.title} (${chatId})`);
    }
    return;
  }

  if (msg.chat.type === 'private' && !ownerIds.includes(String(userId))) {
    return bot.sendMessage(chatId, "Sizda botni boshqarish huquqi yo'q.");
  }

  if (msg.text === '/start') {
    const keyboard = {
      keyboard: [
        [{ text: "Guruhlar ro'yxati" }],
        [{ text: "Oxirgi xabarni o'chirish" }]
      ],
      resize_keyboard: true
    };
    return bot.sendMessage(chatId, 'Botga xush kelibsiz!', { reply_markup: keyboard });
  }

  if (msg.text === "Guruhlar ro'yxati") {
    const groups = await getGroupList();
    if (!groups.length) return bot.sendMessage(chatId, "Bot hech qanday guruhga qo'shilmagan.");
    const list = groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
    return bot.sendMessage(chatId, `📋 Guruhlar:\n${list}`);
  }

    if ((msg.chat.type === 'group' || msg.chat.type === 'supergroup') && msg.text === '/ping') {
    if (!groupIds.find(g => g.id === msg.chat.id)) {
      groupIds.push({ id: msg.chat.id, name: msg.chat.title || 'No name' });
      fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupIds, null, 2));
      return bot.sendMessage(msg.chat.id, "✅ Bu guruh ro'yxatga qo‘shildi.");
    } else {
      return bot.sendMessage(msg.chat.id, "✅ Bu guruh allaqachon ro'yxatda mavjud.");
    }
  }

  if (msg.text === "Oxirgi xabarni o'chirish") {
    const groups = await getGroupList();
    let deleted = 0;
    for (const group of groups) {
      const lastMsg = await SentMessage.findOne({ groupId: group.id }).sort({ sentAt: -1 });
      if (lastMsg) {
        try {
          await bot.deleteMessage(group.id, lastMsg.telegramMessageId);
          deleted++;
        } catch {}
      }
    }
    return bot.sendMessage(chatId, `${deleted} ta xabar o‘chirildi.`);
  }

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

  await PendingMessage.findOneAndUpdate(
    { userId },
    {
      userId,
      message: content,
      groups: []
    },
    { upsert: true }
  );

  await bot.sendMessage(chatId, "Qaysi guruhlarga yuborilsin?", {
    reply_markup: await buildGroupKeyboard(userId)
  });
});

bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  const pending = await PendingMessage.findOne({ userId });
  if (!pending) return;

  const groups = await getGroupList();

  if (data.startsWith('toggle_')) {
    const groupId = parseInt(data.split('_')[1]);
    const idx = pending.groups.indexOf(groupId);
    if (idx >= 0) pending.groups.splice(idx, 1);
    else pending.groups.push(groupId);

    await pending.save();
    return bot.editMessageReplyMarkup(await buildGroupKeyboard(userId), {
      chat_id: chatId,
      message_id: messageId
    });
  }

  if (data === 'send_selected' || data === 'send_all') {
    const targets = data === 'send_all'
      ? groups.map(g => g.id)
      : pending.groups;

    if (!targets.length) {
      return bot.answerCallbackQuery(query.id, { text: "Hech qanday guruh tanlanmagan!", show_alert: true });
    }

    const msgData = pending.message;
    let count = 0;

    for (const gid of targets) {
      try {
        let sent;
        if (msgData.type === 'text') {
          sent = await bot.sendMessage(gid, msgData.data);
        } else if (msgData.type === 'photo') {
          sent = await bot.sendPhoto(gid, msgData.data, { caption: msgData.caption });
        } else if (msgData.type === 'video') {
          sent = await bot.sendVideo(gid, msgData.data, { caption: msgData.caption });
        } else if (msgData.type === 'media_group') {
          sent = await bot.sendMediaGroup(gid, msgData.data);
        }

        if (sent) {
          const now = new Date();
          if (msgData.type === 'media_group') {
            for (const media of msgData.data) {
              await SentMessage.create({
                userId,
                groupId: gid,
                type: media.type,
                content: media.media,
                caption: media.caption || null,
                sentAt: now
              });
            }
          } else {
            await SentMessage.create({
              userId,
              groupId: gid,
              type: msgData.type,
              content: msgData.data,
              caption: msgData.caption || null,
              sentAt: now
            });
          }
        }

        count++;
      } catch (e) {
        console.error(`Xatolik:`, e.message);
      }
    }

    await PendingMessage.deleteOne({ userId });

    await bot.sendMessage(chatId, `✅ ${count} ta guruhga yuborildi.`);
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
      message_id: messageId
    });
  }
});
