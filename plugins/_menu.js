import { plugins } from '../lib/plugins.js'
import { getMenuStyle, updateMenuStyle } from '../lib/database.js'

function formatPluginCommands(cmdArray, prefix = '!') {
    if (!cmdArray || cmdArray.length === 0) return ''
    const primary = `${prefix}${cmdArray[0]}`
    if (cmdArray.length === 1) return primary
    
    const aliases = cmdArray.slice(1)
    const lines = [primary]
    aliases.forEach((alias, index) => {
        const isLast = index === aliases.length - 1
        const treeChar = isLast ? '└─ ' : '├─ '
        lines.push(`${treeChar}${prefix}${alias}`)
    })
    return lines.join('\n')
}

export default {
    cmd: ['menu', 'allmenu', 'help', 'info', 'setmenu'],
    category: 'main',
    run: async (m, { sock, config, text, isOwner }) => {
        const commandUsed = m.body.replace(/^[./#!]/, '').trim().split(/ +/)[0].toLowerCase()

        if (commandUsed === 'setmenu') {
            if (!isOwner) return m.reply("Fitur ini khusus owner.")
            const styleNum = parseInt(text.trim())
            if (styleNum !== 1 && styleNum !== 2) {
                return m.reply("Format salah.\nContoh: `!setmenu 1` atau `!setmenu 2`")
            }
            updateMenuStyle(styleNum)
            return m.reply(`Berhasil mengubah tipe menu menjadi Tipe ${styleNum}.`)
        }

        const menuStyle = getMenuStyle()

        const now = new Date()
        const optionsTime = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
        let time = new Intl.DateTimeFormat('id-ID', optionsTime).format(now).replace(/:/g, '.')
        
        const optionsDate = { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
        const date = new Intl.DateTimeFormat('id-ID', optionsDate).format(now)
        
        const hourStr = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }).format(now)
        const hour = parseInt(hourStr)

        let greeting = ''
        if (hour >= 0 && hour < 11) greeting = 'Pagi ! 🌄'
        else if (hour >= 11 && hour < 15) greeting = 'Siang ! ☀️'
        else if (hour >= 15 && hour < 18) greeting = 'Sore ! 🌅'
        else greeting = 'Malam ! 🌙'

        const categories = {}
        let totalFeatures = 0
        
        for (const [file, plugin] of plugins) {
            const category = plugin.category || 'others'
            if (!categories[category]) categories[category] = []
            categories[category].push(plugin)
            totalFeatures++
        }

        const categoryList = Object.keys(categories).sort()
        const totalCategories = categoryList.length
        
        const isAllMenu = commandUsed === 'allmenu' || text.toLowerCase() === 'all'
        const isInfo = commandUsed === 'info'
        const selectedCategory = text.toLowerCase()

        if (isInfo) {
            let caption = `Aku adalah *${config.botName}*, asisten virtual WhatsApp yang dibuat menggunakan nodejs.\n\n`
            caption += `⌗ *Tanggal:* ${date}\n`
            caption += `⌗ *Waktu:* ${time} WIB\n`
            caption += `⌗ *Total Fitur:* ${totalFeatures}\n`
            caption += `⌗ *Total Kategori:* ${totalCategories}\n`
            caption += `⌗ *Prefix:* [ ., /, #, ! ]\n\n`
            caption += `> *${config.botName}*`
            return m.reply(caption)
        }

        if (isAllMenu) {
            let caption = `📚 *Daftar Semua Menu*\n`
            for (const category of categoryList) {
                caption += `\n› *${category.charAt(0).toUpperCase() + category.slice(1)}* (${categories[category].length})\n`
                if (menuStyle === 2) {
                    caption += categories[category].map(plugin => formatPluginCommands(plugin.cmd, '!')).join('\n') + '\n'
                } else {
                    caption += categories[category].map(plugin => `!${plugin.cmd[0]}`).join('\n') + '\n'
                }
            }
            caption = caption.trim() + `\n\n> *${config.botName}*`
            return m.reply(caption)
        }

        if (text && categories[selectedCategory]) {
            let caption = `📚 *Kategori ${selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)}*\n`
            caption += `\n› *${selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)}* (${categories[selectedCategory].length})\n`
            if (menuStyle === 2) {
                caption += categories[selectedCategory].map(plugin => formatPluginCommands(plugin.cmd, '!')).join('\n') + '\n'
            } else {
                caption += categories[selectedCategory].map(plugin => `!${plugin.cmd[0]}`).join('\n') + '\n'
            }
            caption = caption.trim() + `\n\n> *${config.botName}*`
            return m.reply(caption)
        }

        let caption = `Hi, @${m.sender.split('@')[0]}\n`
        caption += `Selamat ${greeting}\n\n`
        caption += `📚 *Daftar Kategori*\n\n`
        for (const category of categoryList) {
            caption += `› *${category.charAt(0).toUpperCase() + category.slice(1)}* (${categories[category].length})\n`
        }
        caption += `\nSilakan klik button *All Menu* untuk melihat semua command, atau ketik !menu <kategori> untuk melihat command dari kategori spesifik.`

        await sock.sendButtonV2(m.from, {
            title: config.botName,
            subtitle: 'WhatsApp Bot Assistant',
            body: caption.trim(),
            footer: config.botName,
            thumbnail: 'https://s1.nefusoft.my.id/files/BQACAgUAAyEGAATJMpPgAAIBc2oeMkujRa_fkUuXB80ci8kXJSrrAAI5IAACjc3wVD73nYueed3fOwQ.webp',
            contextInfo: {
                mentionedJid: [m.sender]
            },
            buttons: [
                { label: '📚 All Menu', id: '!allmenu' },
                { label: 'ℹ️ Info', id: '!info' }
            ]
        }, { quoted: m })
    }
}