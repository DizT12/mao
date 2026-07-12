import { downloadContentFromMessage } from '@whiskeysockets/baileys'

export default {
    cmd: ['run'],
    category: 'owner',
    run: async (m, { sock, isOwner }) => {
        if (!isOwner) return m.reply("Hanya owner yang bisa menggunakan perintah ini!")
        if (!m.quoted) return m.reply("Reply file .js dulu!")

        const raw = m.quoted
        const type = raw.type
        const docMsg = raw.message?.[type] || raw[type]

        if (!docMsg) return m.reply("Tidak ada dokumen yang direply!")
        if (!/document/i.test(type)) return m.reply("Yang direply bukan dokumen!")
        if (!docMsg.fileName?.endsWith('.js')) return m.reply("Hanya file .js yang didukung!")

        try {
            const stream = await downloadContentFromMessage(docMsg, 'document')
            let buffer = Buffer.from([])
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
            const code = buffer.toString()

            const conn = sock
            const jid = m.from
            const chat = m.from
            const sender = m.sender
            const message = m
            const args = (m.text || '').trim().split(/\s+/).slice(1)

            const result = await eval(`(async () => { ${code} })()`)
            return m.reply(String(result ?? '✅ done'))
        } catch (e) {
            console.error('[run]', e)
            return m.reply('❌ Error:\n' + (e?.message || e))
        }
    }
}