import {
    clearOldSessions,
    formatClearResult,
    getSessionCleanHistory,
    formatHistory,
    getInterval,
    setInterval_,
    getMaxAgeDays,
    setMaxAgeDays
} from '../lib/session-cleaner.js'

export default {
    cmd: ['clearsession', 'sessionhistory', 'sessionconfig'],
    category: 'owner',
    run: async (m, { isOwner }) => {
        if (!isOwner) return m.reply('Hanya owner yang bisa menggunakan perintah ini!')

        const command = (m.text || '').trim().split(/\s+/)[0].replace(/^[.!/#]/, '').toLowerCase()
        const arg = (m.text || '').trim().split(/\s+/)[1]

        // .clearsession [hari] -> jalankan pembersihan manual sekarang
        if (command === 'clearsession') {
            const days = arg && !isNaN(parseInt(arg)) ? parseInt(arg) : undefined
            const effectiveDays = days ?? getMaxAgeDays()

            await m.reply(`⏳ Membersihkan file session lebih dari ${effectiveDays} hari...`)
            const result = await clearOldSessions(days, 'manual')

            if (result.errors.length && result.scanned === 0) {
                return m.reply(`❌ Gagal membersihkan session:\n${result.errors.join('\n')}`)
            }

            return m.reply(formatClearResult(result, effectiveDays))
        }

        // .sessionhistory [jumlah] -> lihat riwayat clear session
        if (command === 'sessionhistory') {
            const limit = arg && !isNaN(parseInt(arg)) ? parseInt(arg) : 10
            const entries = getSessionCleanHistory(limit)
            return m.reply(formatHistory(entries))
        }

        // .sessionconfig -> lihat/atur interval auto & batas umur file
        if (command === 'sessionconfig') {
            const sub = arg?.toLowerCase()
            const value = (m.text || '').trim().split(/\s+/)[2]

            if (sub === 'interval' && value && !isNaN(parseFloat(value)) && parseFloat(value) > 0) {
                const hours = parseFloat(value)
                setInterval_(hours)
                return m.reply(`✅ Interval auto-clear diubah ke *${hours} jam*.\n\nBerlaku otomatis, tidak perlu restart bot.`)
            }

            if (sub === 'maxage' && value && !isNaN(parseInt(value)) && parseInt(value) >= 0) {
                const days = parseInt(value)
                setMaxAgeDays(days)
                return m.reply(`✅ Batas umur file session diubah ke *${days} hari*.\n\nFile lebih tua dari ini akan dihapus otomatis (kecuali creds.json).`)
            }

            const currentInterval = getInterval()
            const currentMaxAge = getMaxAgeDays()
            return m.reply(
                `⚙️ *KONFIGURASI SESSION CLEANER*\n\n` +
                `Interval auto-clear: *${currentInterval} jam*\n` +
                `Batas umur file: *${currentMaxAge} hari*\n\n` +
                `Ubah interval: \`.sessionconfig interval <jam>\`\n` +
                `Ubah batas umur: \`.sessionconfig maxage <hari>\`\n\n` +
                `Lihat riwayat: \`.sessionhistory [jumlah]\`\n` +
                `Jalankan manual: \`.clearsession [hari]\``
            )
        }
    }
}

