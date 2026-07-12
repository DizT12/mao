import { downloadContentFromMessage } from '@whiskeysockets/baileys'

export default {
    cmd: ['rvo'],
    category: 'tools',
    run: async (m, { sock }) => {
        if (!m.quoted) return m.reply('Reply ke pesan sekali lihat!')

        const mediaMsg = m.quoted[m.quoted.type]
        const type = m.quoted.type.replace('Message', '')

        if (!/image|video/.test(type)) {
            return m.reply('Hanya untuk foto/video sekali lihat.')
        }

        try {
            const stream = await downloadContentFromMessage(mediaMsg, type)
            let buffer = Buffer.from([])
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

            if (type === 'image') {
                await sock.sendImage(m.from, buffer, mediaMsg.caption || '', m)
            } else if (type === 'video') {
                await sock.sendVideo(m.from, buffer, mediaMsg.caption || '', m)
            }
        } catch (e) {
            console.error(e)
            m.reply('Gagal membuka pesan. Mungkin sudah kadaluarsa.')
        }
    }
}