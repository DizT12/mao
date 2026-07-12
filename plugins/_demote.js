import { jidNormalizedUser } from '@whiskeysockets/baileys'

export default {
    cmd: ['demote', 'turunkan'],
    category: 'group',
    run: async (m, { sock, text, isAdmin, isBotAdmin, config }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isAdmin) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')
        if (!isBotAdmin) return m.reply('Bot harus menjadi admin untuk menurunkan jabatan admin.')

        let targets = []

        if (m.message[m.type]?.contextInfo?.mentionedJid?.length > 0) {
            targets = m.message[m.type].contextInfo.mentionedJid
        } else if (m.quoted) {
            targets = [m.quoted.sender]
        } else if (text) {
            let numbers = text.replace(/[^0-9]/g, '')
            if (numbers.length >= 10) {
                targets = [numbers + '@s.whatsapp.net']
            }
        }

        if (targets.length === 0) {
            let help = `⌗ *Demote System*\n\n`
            help += `Gunakan perintah ini untuk menurunkan jabatan admin menjadi member.\n\n`
            help += `› .demote @user\n`
            help += `› .demote 62831xxx\n`
            help += `› .demote (reply pesan target)\n\n`
            help += `> *${config.botName}*`
            return m.reply(help)
        }

        const ownerNumbers = config.ownerNumber.map(n => n.replace(/[^0-9]/g, '') + '@s.whatsapp.net')
        const botJid = jidNormalizedUser(sock.user.id)

        for (let target of targets) {
            let jid = jidNormalizedUser(target)

            if (jid === botJid) {
                m.reply('Mana bisa aku turunkan jabatanku sendiri!')
                continue
            }
            if (ownerNumbers.includes(jid)) {
                m.reply('Jabatan Owner tidak bisa diturunkan!')
                continue
            }

                    try {
                        await sock.groupParticipantsUpdate(m.from, [jid], 'demote')
                        await m.reply(`✅ Berhasil menurunkan jabatan @${jid.split('@')[0]} menjadi Member.`, { mentions: [jid] })
                    } catch (e) {
                        console.error(e)
                        m.reply(`Gagal menurunkan jabatan @${jid.split('@')[0]}.`)
                    }
        }
    }
}