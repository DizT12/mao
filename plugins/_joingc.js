export default {
    cmd: ['join'],
    category: 'owner',
    run: async (m, { sock, text, isOwner }) => {
        if (!isOwner) return

        if (!text) return m.reply("Format salah. Gunakan: `.join <link_grup>`")

        const regex = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i
        const match = text.match(regex)

        if (!match) return m.reply("Link grup tidak valid!")

        const code = match[1]

        try {
            await sock.groupAcceptInvite(code)
            return m.reply("Berhasil bergabung ke grup!")
        } catch (e) {
            return m.reply(`Gagal bergabung ke grup: ${e.message || e}`)
        }
    }
}