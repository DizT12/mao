import fs from 'fs'
import path from 'path'
import { plugins } from '../lib/plugins.js'

const getAllFiles = (dir, baseDir = dir) => {
    let results = []
    if (!fs.existsSync(dir)) return results
    const list = fs.readdirSync(dir)
    list.forEach((file) => {
        const fullPath = path.join(dir, file)
        const stat = fs.statSync(fullPath)
        if (stat && stat.isDirectory()) {
            results = results.concat(getAllFiles(fullPath, baseDir))
        } else if (file.endsWith('.js')) {
            results.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'))
        }
    })
    return results
}

export default {
    cmd: ['?plugins', '+plugins', '-plugins', 'plugins'],
    category: 'owner',
    run: async (m, { sock, config, text, isOwner }) => {
        if (!isOwner) return m.reply("Fitur ini khusus untuk owner.")

        const commandUsed = m.body.replace(/^[./#!]/, '').trim().split(/ +/)[0].toLowerCase()

        if (commandUsed === '?plugins' || commandUsed === 'plugins') {
            if (!text) {
                const files = getAllFiles('./plugins')
                let caption = `📂 *Daftar File Plugins (${files.length})*\n\n`
                caption += files.map((f, i) => `${i + 1}. \`${f}\``).join('\n')
                caption += `\n\n_Ketik .?plugins <nama_file> untuk membaca kode_`
                return m.reply(caption)
            }

            let targetFile = text.trim()
            if (!targetFile.endsWith('.js')) targetFile += '.js'

            const fullPath = path.resolve('./plugins', targetFile)
            const pluginsDir = path.resolve('./plugins')
            if (!fullPath.startsWith(pluginsDir)) {
                return m.reply("Akses ditolak.")
            }

            if (!fs.existsSync(fullPath)) {
                return m.reply(`File \`plugins/${targetFile}\` tidak ditemukan.`)
            }

            const codeContent = fs.readFileSync(fullPath, 'utf-8')
            await sock.sendAIRich(m.from, {
                text: `Path: *plugins/${targetFile}*`,
                code: {
                    language: 'javascript',
                    code: codeContent
                }
            }, { quoted: m })
            return
        }

        if (commandUsed === '+plugins') {
            const spaceIndex = text.indexOf(' ')
            const newlineIndex = text.indexOf('\n')
            let splitIndex = -1
            if (spaceIndex !== -1 && newlineIndex !== -1) {
                splitIndex = Math.min(spaceIndex, newlineIndex)
            } else {
                splitIndex = spaceIndex !== -1 ? spaceIndex : newlineIndex
            }

            if (splitIndex === -1) {
                return m.reply("Format salah.\nContoh: `.+plugins folder/file.js <code>`")
            }

            let relativePath = text.slice(0, splitIndex).trim()
            const code = text.slice(splitIndex).trim()

            if (!relativePath.endsWith('.js')) relativePath += '.js'
            
            const fullPath = path.resolve('./plugins', relativePath)
            const pluginsDir = path.resolve('./plugins')
            if (!fullPath.startsWith(pluginsDir)) {
                return m.reply("Akses ditolak.")
            }

            try {
                fs.mkdirSync(path.dirname(fullPath), { recursive: true })
                fs.writeFileSync(fullPath, code, 'utf-8')
                return m.reply(`Berhasil membuat/memperbarui file \`plugins/${relativePath}\`.`)
            } catch (e) {
                return m.reply(`Gagal menulis file: ${e.message}`)
            }
        }

        if (commandUsed === '-plugins') {
            if (!text) return m.reply("Masukkan nama file yang ingin dihapus.\nContoh: `.-plugins folder/file.js`")

            let targetFile = text.trim()
            if (!targetFile.endsWith('.js')) targetFile += '.js'

            const fullPath = path.resolve('./plugins', targetFile)
            const pluginsDir = path.resolve('./plugins')
            if (!fullPath.startsWith(pluginsDir)) {
                return m.reply("Akses ditolak.")
            }

            if (!fs.existsSync(fullPath)) {
                return m.reply(`File \`plugins/${targetFile}\` tidak ditemukan.`)
            }

            try {
                fs.unlinkSync(fullPath)
                plugins.delete(targetFile)
                return m.reply(`Berhasil menghapus file \`plugins/${targetFile}\` dari penyimpanan dan memory.`)
            } catch (e) {
                return m.reply(`Gagal menghapus file: ${e.message}`)
            }
        }
    }
}
