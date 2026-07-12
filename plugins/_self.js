import { getBotMode, setBotMode } from '../lib/database.js'

export default {
    cmd: ['self', 'public'],
    category: 'owner',
    run: async (m, { isOwner }) => {
        if (!isOwner) return m.reply("Fitur ini khusus owner.")

        const commandUsed = m.body.replace(/^[./#!]/, '').trim().split(/ +/)[0].toLowerCase()
        const currentMode = getBotMode()

        if (commandUsed === 'self') {
            if (currentMode === 'self') return m.reply("Mode Self sudah aktif sebelumnya.")
            setBotMode('self')
            return m.reply("Mode Self berhasil diaktifkan. Mulai sekarang bot hanya akan merespon pesan dari owner.")
        }

        if (commandUsed === 'public') {
            if (currentMode === 'public') return m.reply("Mode Public sudah aktif sebelumnya.")
            setBotMode('public')
            return m.reply("Mode Public berhasil diaktifkan. Bot kembali merespon semua pengguna.")
        }
    }
}
