import { basename, extname } from 'path'
import crypto from 'crypto'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

const AGENT = 'Mozilla/5.0 (Linux; Android 8.0; Pixel 2 Build/OPD3.170816.012) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36'
const SALT = 'hackers_become_a_little_stinkier_every_time_they_hack'

const md5 = s => crypto.createHash('md5').update(s).digest('hex')
const reverse = s => s.split('').reverse().join('')
const generateRandomIP = () => Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 254)).join('.')

const mime = ext => ({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}[ext.toLowerCase()] || 'application/octet-stream')

function genKEY() {
  const r = String(Math.floor(Math.random() * 1e11))
  const h1 = reverse(md5(AGENT + r + SALT))
  const h2 = reverse(md5(AGENT + h1))
  const h3 = reverse(md5(AGENT + h2))
  return `tryit-${r}-${h3}`
}

async function editImage(buffer, filename, prompt) {
  let last = 'request failed'

  for (let i = 0; i < 6; i++) {
    try {
      const form = new FormData()

      form.append(
        'image',
        new Blob([buffer], { type: mime(extname(filename)) }),
        basename(filename)
      )

      form.append('text', prompt)
      form.append('image_generator_version', 'standard')

      const res = await fetch('https://api.deepai.org/api/image-editor', {
        method: 'POST',
        headers: {
          accept: '*/*',
          origin: 'https://deepai.org',
          referer: 'https://deepai.org/',
          'user-agent': AGENT,
          'api-key': genKEY(),
          'x-forwarded-for': generateRandomIP()
        },
        body: form
      })

      const json = await res.json().catch(() => null)

      if (json?.output_url) {
        return Buffer.from(
          await (await fetch(json.output_url)).arrayBuffer()
        )
      }

      last = json?.status || `http ${res.status}`
    } catch (e) {
      last = e.message
    }
  }

  throw new Error(last)
}

export default {
  cmd: ['ei', 'editimg', 'deepedit'],
  category: 'ai',
  run: async (m, { sock, text }) => {
    let q = m.quoted ? m.quoted : m
    let type = q.type
    let mediaMsg = q === m.quoted ? q[type] : m.message[type]

    if (/ephemeral|viewOnce/.test(type)) {
      const innerType = Object.keys(mediaMsg.message || mediaMsg)[0]
      mediaMsg = (mediaMsg.message || mediaMsg)[innerType]
      type = innerType
    }

    let mimeType = mediaMsg?.mimetype || ''

    if (!/image\/(jpe?g|png|webp)/i.test(mimeType)) {
      return m.reply("Cara pakai:\n!ei <prompt>\n\nContoh:\n!ei make it cinematic\n!ei turn into anime\n!ei add neon lights\n\nReply atau kirim gambar dengan caption !ei")
    }

    if (!text) {
      return m.reply("Cara pakai:\n!ei <prompt>\n\nContoh:\n!ei make it cinematic\n!ei turn into anime\n!ei add neon lights\n\nReply atau kirim gambar dengan caption !ei")
    }

    m.reply('⏳ Sedang memproses gambar...')

    try {
      const stream = await downloadContentFromMessage(mediaMsg, 'image')
      let buffer = Buffer.from([])
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

      const result = await editImage(buffer, 'image.jpg', text)

      await sock.sendMessage(
        m.from,
        {
          image: result,
          caption: `✅ Berhasil mengedit gambar\n\n📝 Prompt:\n${text}`
        },
        { quoted: m }
      )
    } catch (err) {
      m.reply(`❌ Gagal memproses gambar:\n${err.message}`)
    }
  }
}