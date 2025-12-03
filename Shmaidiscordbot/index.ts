{\rtf1\ansi\ansicpg1252\cocoartf2757
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 // index.ts\
import \{ Client, GatewayIntentBits, TextChannel \} from 'discord.js';\
import express from 'express';\
import multer from 'multer';\
import fetch from 'node-fetch';\
import dotenv from 'dotenv';\
\
dotenv.config();\
\
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;\
const WEBHOOK_URL = process.env.WEBHOOK_URL;\
const PORT = process.env.PORT || 3000;\
\
if (!DISCORD_TOKEN || !WEBHOOK_URL) \{\
  console.error('Missing DISCORD_TOKEN or WEBHOOK_URL in environment variables.');\
  process.exit(1);\
\}\
\
// Set up Discord client\
const client = new Client(\{\
  intents: [\
    GatewayIntentBits.Guilds,\
    GatewayIntentBits.GuildMessages,\
    GatewayIntentBits.MessageContent,\
  ],\
\});\
\
client.once('ready', () => \{\
  console.log(`Logged in as $\{client.user?.tag\}`);\
\});\
\
// Listen for new messages from Discord and forward to webhook\
client.on('messageCreate', async (message) => \{\
  if (message.author.bot) return; // Ignore bot messages\
\
  const data = \{\
    type: 'message',\
    author: message.author.username,\
    content: message.content,\
    channelId: message.channelId,\
    attachments: message.attachments.map((attachment) => attachment.url),\
  \};\
\
  try \{\
    await fetch(WEBHOOK_URL, \{\
      method: 'POST',\
      headers: \{ 'Content-Type': 'application/json' \},\
      body: JSON.stringify(data),\
    \});\
    console.log('Message forwarded to webhook');\
  \} catch (error) \{\
    console.error('Error forwarding message:', error);\
  \}\
\});\
\
client.login(DISCORD_TOKEN);\
\
// Set up Express server to receive POST requests for sending messages/files to Discord\
const app = express();\
const upload = multer(\{ storage: multer.memoryStorage() \});\
\
app.use(express.json());\
\
app.post('/send', upload.array('files'), async (req, res) => \{\
  const \{ channelId, content \} = req.body;\
  const files = req.files as Express.Multer.File[];\
\
  if (!channelId) \{\
    return res.status(400).json(\{ error: 'channelId is required' \});\
  \}\
\
  try \{\
    const channel = (await client.channels.fetch(channelId)) as TextChannel;\
    if (!channel || channel.type !== 0) \{ // 0 is TextChannel\
      return res.status(404).json(\{ error: 'Invalid channel' \});\
    \}\
\
    const attachments = files?.map((file) => (\{\
      attachment: file.buffer,\
      name: file.originalname,\
    \})) || [];\
\
    await channel.send(\{ content, files: attachments \});\
    res.json(\{ success: true, message: 'Message sent to Discord' \});\
  \} catch (error) \{\
    console.error('Error sending message:', error);\
    res.status(500).json(\{ error: 'Failed to send message' \});\
  \}\
\});\
\
app.listen(PORT, () => \{\
  console.log(`Server listening on port $\{PORT\}`);\
\});}