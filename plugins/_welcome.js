import { getGroupSettings, updateGroupSettings } from '../lib/database.js'

export default {
    cmd: ['welcome'],
    category: 'group',
    run: async (m, { sock, text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Khusus Grup!')
        if (!isAdmin) return m.reply('Khusus Admin Grup!')

        const args = text.split(' ')
        const action = args[0] ? args[0].toLowerCase() : ''
        const settings = await getGroupSettings(m.from)

        if (action === 'on') {
            await updateGroupSettings(m.from, 'welcome', 1)
            m.reply('Welcome Message berhasil diaktifkan!')
        } else if (action === 'off') {
            await updateGroupSettings(m.from, 'welcome', 0)
            m.reply('Welcome Message berhasil dimatikan!')
        } else if (action === 'set') {
            const newText = text.slice(3).trim()
            if (!newText) return m.reply('Masukan teks welcome nya!')
            await updateGroupSettings(m.from, 'welcomeText', newText)
            m.reply('Teks Welcome berhasil diubah!')
        } else {
            let status = settings.welcome ? 'ON' : 'OFF'
            let caption = `⌗ *Welcome System*\n\n`
            caption += `Status: *[ ${status} ]*\n\n`
            caption += `› .welcome on\n`
            caption += `› .welcome off\n`
            caption += `› .welcome set <teks>\n\n`
            caption += `*Variables:*\n`
            caption += `@pushname, @gcname, @desc, @date, @jam`
            m.reply(caption)
        }
    }
}