import { jidNormalizedUser } from '@whiskeysockets/baileys'

export default {
    cmd: ['promote', 'jadikanadmin'],
    category: 'group',
    run: async (m, { sock, text, isAdmin, isBotAdmin, config }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isAdmin) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')
        if (!isBotAdmin) return m.reply('Bot harus menjadi admin untuk mempromosikan member.')

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
            let help = `⌗ *Promote System*\n\n`
            help += `Gunakan perintah ini untuk menjadikan member sebagai admin.\n\n`
            help += `› .promote @user\n`
            help += `› .promote 62831xxx\n`
            help += `› .promote (reply pesan target)\n\n`
            help += `> *${config.botName}*`
            return m.reply(help)
        }

        const botJid = jidNormalizedUser(sock.user.id)

        for (let target of targets) {
            let jid = jidNormalizedUser(target)

            if (jid === botJid) {
                m.reply('Aku sudah menjadi admin!')
                continue
            }

            try {
                await sock.groupParticipantsUpdate(m.from, [jid], 'promote')
                await m.reply(`✅ Berhasil mempromosikan @${jid.split('@')[0]} sebagai Admin.`, { mentions: [jid] })
            } catch (e) {
                console.error(e)
                m.reply(`Gagal mempromosikan @${jid.split('@')[0]}.`)
            }
        }
    }
}