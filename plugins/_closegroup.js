export default {
    cmd: ['close', 'tutup', 'closegroup'],
    category: 'group',
    run: async (m, { sock, isAdmin, isBotAdmin }) => {
        if (!m.isGroup) return m.reply("Fitur ini hanya dapat digunakan di dalam grup.")
        if (!isAdmin) return m.reply("Hanya admin grup yang dapat menggunakan perintah ini.")
        if (!isBotAdmin) return m.reply("Bot harus menjadi admin untuk mengubah setelan grup.")
        try {
            await sock.groupSettingUpdate(m.from, 'announcement')
            return m.reply("Berhasil menutup grup. Sekarang hanya admin yang dapat mengirimkan pesan.")
        } catch (e) {
            return m.reply("Gagal menutup grup.")
        }
    }
}