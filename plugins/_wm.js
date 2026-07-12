import { downloadContentFromMessage } from '@whiskeysockets/baileys'

export default {
    cmd: ['wm', 'take', 'colong'],
    category: 'tools',
    run: async (m, { sock, text }) => {
        if (!m.quoted) return m.reply("Silakan balas/reply stiker yang ingin diubah watermark-nya.")

        let type = m.quoted.type
        if (type !== 'stickerMessage') return m.reply("Fitur ini hanya dapat digunakan dengan membalas sebuah stiker.")

        if (!text) return m.reply("Format salah.\nContoh: `!wm maomao | apothecary diaries`")

        let [pack, auth] = text.split('|').map(v => v.trim())
        if (!pack) pack = 'MaoMao - Ai !'
        if (!auth) auth = 'MaoMao - Ai Bot'

        await sock.sendMessage(m.from, { react: { text: '⏳', key: m.key } })

        try {
            const mediaMsg = m.quoted.stickerMessage
            const stream = await downloadContentFromMessage(mediaMsg, 'sticker')
            let buffer = Buffer.from([])
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

            await sock.sendSticker(m.from, buffer, m, {
                packname: pack,
                author: auth
            })

            await sock.sendMessage(m.from, { react: { text: '✅', key: m.key } })
        } catch (e) {
            await sock.sendMessage(m.from, { react: { text: '❌', key: m.key } })
            m.reply(`Gagal mengubah watermark stiker: ${e.message}`)
        }
    }
}