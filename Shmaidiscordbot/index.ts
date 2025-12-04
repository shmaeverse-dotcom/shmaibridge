// index.ts
import { Client, GatewayIntentBits, TextChannel } from 'discord.js';
import express from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Original webhook for forwarding messages
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL; // New: Webhook URL for n8n to receive commands from Discord
const PREFIX = process.env.COMMAND_PREFIX || '!'; // Prefix for commands, e.g., !run
const PORT = process.env.PORT || 3000;

if (!DISCORD_TOKEN || !N8N_WEBHOOK_URL) {
  console.error('Missing DISCORD_TOKEN or N8N_WEBHOOK_URL in environment variables.');
  process.exit(1);
}

// Set up Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user?.tag} on Railway`);
});

// Listen for new messages from Discord
// Inside index.ts – replace the old messageCreate event
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Check if message has attachments (audio, video, image, etc.)
  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      try {
        // Download the file as a buffer
        const response = await fetch(attachment.url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Prepare form data (this is what n8n expects for real files)
        const formData = new FormData();
        formData.append('file', buffer, {
          filename: attachment.name,
          contentType: attachment.contentType || 'application/octet-stream',
        });

        // Add useful metadata
        formData.append('discord_user', message.author.username);
        formData.append('user_id', message.author.id);
        formData.append('channel_id', message.channelId);
        formData.append('message_id', message.id);
        formData.append('filename', attachment.name);
        formData.append('file_size', attachment.size.toString());
        formData.append('uploaded_at', new Date().toISOString());

        // Send to n8n webhook
        await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          body: formData,
        });

        console.log(`Sent file to n8n: ${attachment.name}`);
        message.react('✅'); // Optional: confirm in Discord
      } catch (error) {
        console.error('Failed to forward file:', error);
        message.react('❌');
      }
    }
  }

  // Optional: Still handle text commands like !run if you want
  if (message.content.startsWith('!')) {
    // ... your existing command code
  }
});

  // Original: Forward all messages to WEBHOOK_URL (optional, keep if needed)
  if (WEBHOOK_URL) {
    const data = {
      type: 'message',
      author: message.author.username,
      content: message.content,
      channelId: message.channelId,
      attachments: message.attachments.map((attachment) => attachment.url),
    };

    try {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      console.log('Message forwarded to original webhook');
    } catch (error) {
      console.error('Error forwarding message:', error);
    }
  }

  // New: Handle commands starting with PREFIX, e.g., !run <payload>
  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    if (command === 'run') {
      const payload = args.join(' '); // The rest is the payload for n8n
      if (!payload) {
        return message.reply('Please provide a payload for the command, e.g., !run your data here');
      }

      const commandData = {
        type: 'discord_command',
        command: 'run',
        payload,
        author: message.author.username,
        channelId: message.channelId,
        userId: message.author.id,
        timestamp: new Date().toISOString(),
      };

      try {
        const response = await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(commandData),
        });

        if (response.ok) {
          console.log('Command sent to n8n successfully');
          message.reply('Command executed and sent to n8n! Check the workflow for results.');
        } else {
          console.error('n8n responded with error:', response.status);
          message.reply('Error sending command to n8n. Try again later.');
        }
      } catch (error) {
        console.error('Error sending command to n8n:', error);
        message.reply('Failed to connect to n8n. Please check the setup.');
      }
    }
  }
});

client.login(DISCORD_TOKEN);

// Set up Express server to receive POST requests (e.g., from n8n) for sending messages/files back to Discord
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

app.post('/send', upload.array('files'), async (req, res) => {
  const { channelId, content, mentionUserId } = req.body; // Added optional mentionUserId for replies
  const files = req.files as Express.Multer.File[];

  if (!channelId) {
    return res.status(400).json({ error: 'channelId is required' });
  }

  try {
    const channel = (await client.channels.fetch(channelId)) as TextChannel;
    if (!channel || channel.type !== 0) { // 0 is TextChannel
      return res.status(404).json({ error: 'Invalid channel' });
    }

    const attachments = files?.map((file) => ({
      attachment: file.buffer,
      name: file.originalname,
    })) || [];

    let sendContent = content;
    if (mentionUserId) {
      const user = await client.users.fetch(mentionUserId);
      sendContent = `<@${mentionUserId}> ${content}`; // Mention the user in the reply
    }

    await channel.send({ content: sendContent, files: attachments });
    res.json({ success: true, message: 'Response sent to Discord' });
  } catch (error) {
    console.error('Error sending response:', error);
    res.status(500).json({ error: 'Failed to send response to Discord' });
  }
});

// Health check endpoint for Railway (recommended for deployments)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (Railway-ready)`);
});