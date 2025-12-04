// index.ts
import { Client, GatewayIntentBits, TextChannel, Attachment } from 'discord.js';
import express from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import dotenv.config(); from 'dotenv';
import FormData from 'form-data'; // Explicitly import FormData

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const PREFIX = process.env.COMMAND_PREFIX || '!';
const PORT = process.env.PORT || 3000;

if (!DISCORD_TOKEN || !N8N_WEBHOOK_URL) {
  console.error('Missing DISCORD_TOKEN or N8N_WEBHOOK_URL in environment variables.');
  process.exit(1);
}

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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
          console.error(`Failed to fetch attachment: ${attachment.name} - ${response.status} ${response.statusText}`);
          message.react('❌');
          continue; // Skip to the next attachment
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const formData = new FormData();
        formData.append('file', buffer, {
          filename: attachment.name,
          contentType: attachment.contentType || 'application/octet-stream',
        });

        formData.append('discord_user', message.author.username);
        formData.append('user_id', message.author.id);
        formData.append('channel_id', message.channelId);
        formData.append('message_id', message.id);
        formData.append('filename', attachment.name);
        formData.append('file_size', attachment.size.toString());
        formData.append('uploaded_at', new Date().toISOString());

        const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          body: formData as any, // FormData is not directly compatible with fetch's body type
        });

        if (!n8nResponse.ok) {
          console.error(`n8n responded with error: ${n8nResponse.status} ${n8nResponse.statusText}`);
          message.react('❌');
          continue; // Skip to the next attachment
        }

        console.log(`Sent file to n8n: ${attachment.name}`);
        message.react('✅');
      } catch (error) {
        console.error('Failed to forward file:', error);
        message.react('❌');
      }
    }
  }

  if (WEBHOOK_URL) {
    try {
      const data = {
        type: 'message',
        author: message.author.username,
        content: message.content,
        channelId: message.channelId,
        attachments: message.attachments.map((attachment: Attachment) => attachment.url),
      };

      const webhookResponse = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!webhookResponse.ok) {
        console.error(`Webhook responded with error: ${webhookResponse.status} ${webhookResponse.statusText}`);
      } else {
        console.log('Message forwarded to original webhook');
      }
    } catch (error) {
      console.error('Error forwarding message:', error);
    }
  }

  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    if (command === 'run') {
      const payload = args.join(' ');
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
          console.error(`n8n responded with error: ${response.status} ${response.statusText}`);
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

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

app.post('/send', upload.array('files'), async (req, res) => {
  const { channelId, content, mentionUserId } = req.body;
  const files = req.files as Express.Multer.File[];

  if (!channelId) {
    return res.status(400).json({ error: 'channelId is required' });
  }

  try {
    const channel = await client.channels.fetch(channelId) as TextChannel;
    if (!channel || channel.type !== 0) {
      return res.status(404).json({ error: 'Invalid channel' });
    }

    const attachments = files?.map((file) => ({
      attachment: file.buffer,
      name: file.originalname,
    })) || [];

    let sendContent = content;
    if (mentionUserId) {
      try {
        await client.users.fetch(mentionUserId); // Validate user ID before mentioning
        sendContent = `<@${mentionUserId}> ${content}`;
      } catch (userError) {
        console.error(`Invalid mentionUserId: ${mentionUserId}`, userError);
        sendContent = `Invalid User Mentioned: ${content}`; // Or handle it differently
      }
    }

    await channel.send({ content: sendContent, files: attachments });
    res.json({ success: true, message: 'Response sent to Discord' });
  } catch (error) {
    console.error('Error sending response:', error);
    res.status(500).json({ error: 'Failed to send response to Discord' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (Railway-ready)`);
});



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
