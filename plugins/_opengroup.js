export default {
    cmd: ['open', 'buka', 'opengroup'],
    category: 'group',
    run: async (m, { sock, isAdmin, isBotAdmin }) => {
        if (!m.isGroup) return m.reply("Fitur ini hanya dapat digunakan di dalam grup.")
        if (!isAdmin) return m.reply("Hanya admin grup yang dapat menggunakan perintah ini.")
        if (!isBotAdmin) return m.reply("Bot harus menjadi admin untuk mengubah setelan grup.")
        try {
            await sock.groupSettingUpdate(m.from, 'not_announcement')
            return m.reply("Berhasil membuka grup. Sekarang seluruh anggota grup dapat mengirimkan pesan.")
        } catch (e) {
            return m.reply("Gagal membuka grup.")
        }
    }
}