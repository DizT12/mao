import { AIRich } from '../lib/helper.js'

export default {
    cmd: ['airich', 'ar'],
    category: 'tools',
    run: async (m, { sock }) => {
        const args = (m.text || '').trim().toLowerCase()

        const rich = new AIRich(sock)

        if (!args || args === 'demo') {
            // Demo semua fitur
            rich
                .addText('## 🎨 AIRich Demo\n\nIni adalah demo fitur **AIRich** yang tersedia di bot ini.')
                .addText('### Fitur yang tersedia:\n- `.ar text <pesan>` — teks rich\n- `.ar code <bahasa> | <kode>` — code block\n- `.ar table` — tabel\n- `.ar demo` — demo ini')
                .addTable([
                    ['Fitur', 'Deskripsi', 'Status'],
                    ['Text', 'Teks dengan markdown', '✅'],
                    ['Code', 'Code block dengan syntax', '✅'],
                    ['Table', 'Tabel data', '✅'],
                    ['Source', 'Link sumber', '✅'],
                ])
            return await rich.send(m.from, { quoted: m })
        }

        if (args.startsWith('text ')) {
            const text = m.text.slice(5).trim()
            if (!text) return m.reply("Format: `.ar text <pesan>`")
            rich.addText(text)
            return await rich.send(m.from, { quoted: m })
        }

        if (args.startsWith('code ')) {
            const rest = m.text.slice(5).trim()
            const [lang, ...codeParts] = rest.split('|')
            const code = codeParts.join('|').trim()
            if (!lang || !code) return m.reply("Format: `.ar code <bahasa> | <kode>`")
            rich.addText(`**${lang.trim().toUpperCase()} Code:**`)
            rich.addCode(lang.trim(), code)
            return await rich.send(m.from, { quoted: m })
        }

        if (args === 'table') {
            rich
                .addText('## 📊 Contoh Tabel')
                .addTable([
                    ['Nama', 'Role', 'Status'],
                    ['MaoMao', 'Bot', '🟢 Online'],
                    ['Bilsanz', 'Owner', '⭐ Admin'],
                    ['User', 'Member', '🔵 Active'],
                ])
            return await rich.send(m.from, { quoted: m })
        }

        return m.reply("*AIRich Commands:*\n\n`.ar demo` — demo semua fitur\n`.ar text <pesan>` — teks rich\n`.ar code <bahasa> | <kode>` — code block\n`.ar table` — contoh tabel")
    }
}