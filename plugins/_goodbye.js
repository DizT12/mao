import { getGroupSettings, updateGroupSettings } from '../lib/database.js'

export default {
    cmd: ['goodbye'],
    category: 'group',
    run: async (m, { sock, text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Khusus Grup!')
        if (!isAdmin) return m.reply('Khusus Admin Grup!')

        const args = text.split(' ')
        const action = args[0] ? args[0].toLowerCase() : ''
        const settings = await getGroupSettings(m.from)

        if (action === 'on') {
            await updateGroupSettings(m.from, 'goodbye', 1)
            m.reply('Goodbye Message berhasil diaktifkan!')
        } else if (action === 'off') {
            await updateGroupSettings(m.from, 'goodbye', 0)
            m.reply('Goodbye Message berhasil dimatikan!')
        } else if (action === 'set') {
            const newText = text.slice(3).trim()
            if (!newText) return m.reply('Masukan teks goodbye nya!')
            await updateGroupSettings(m.from, 'goodbyeText', newText)
            m.reply('Teks Goodbye berhasil diubah!')
        } else {
            let status = settings.goodbye ? 'ON' : 'OFF'
            let caption = `⌗ *Goodbye System*\n\n`
            caption += `Status: *[ ${status} ]*\n\n`
            caption += `› .goodbye on\n`
            caption += `› .goodbye off\n`
            caption += `› .goodbye set <teks>\n\n`
            caption += `*Variables:*\n`
            caption += `@pushname, @gcname, @desc, @date, @jam`
            m.reply(caption)
        }
    }
}