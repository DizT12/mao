import crypto from 'crypto'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')

// ===== Penyimpanan pack per-user (persisten di disk, bukan global.db) =====
// Karena buffer sticker gak muat disimpan rapi di JSON, kita simpan tiap
// sticker sebagai file terpisah di database/tspk/<sender>/<sha256>.<ext>,
// dan metadata-nya (urutan, tipe) di file index JSON per sender.
const STORE_DIR = './database/tspk'

function getUserDir(sender) {
    const dir = path.join(STORE_DIR, sender.replace(/[^0-9a-zA-Z@._-]/g, '_'))
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
}

function getIndexPath(sender) {
    return path.join(getUserDir(sender), 'index.json')
}

function loadPackIndex(sender) {
    const idxPath = getIndexPath(sender)
    if (!fs.existsSync(idxPath)) return []
    try {
        return JSON.parse(fs.readFileSync(idxPath, 'utf-8'))
    } catch {
        return []
    }
}

function savePackIndex(sender, index) {
    fs.writeFileSync(getIndexPath(sender), JSON.stringify(index, null, 2), 'utf-8')
}

function loadStickerBuffer(sender, mediaName, ext) {
    const filePath = path.join(getUserDir(sender), `${mediaName}.${ext}`)
    return fs.readFileSync(filePath)
}

function saveStickerBuffer(sender, mediaName, ext, buffer) {
    const filePath = path.join(getUserDir(sender), `${mediaName}.${ext}`)
    fs.writeFileSync(filePath, buffer)
}

// Cari nomor urut berikutnya yang belum dipakai (media_1, media_2, dst),
// supaya nama file tetap pendek dan rapi walau ada sticker yang dihapus
// di tengah (tidak asal nambah dari panjang index, biar tidak bentrok).
function getNextMediaName(index) {
    const usedNumbers = index
        .map(v => {
            const match = /^media_(\d+)$/.exec(v.mediaName || '')
            return match ? parseInt(match[1]) : 0
        })
        .filter(n => n > 0)

    const next = usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1
    return `media_${next}`
}

function deleteStickerFile(sender, mediaName, ext) {
    const filePath = path.join(getUserDir(sender), `${mediaName}.${ext}`)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

// ===== Util =====

function sha256Of(stickerMessage) {
    return Buffer.from(stickerMessage.fileSha256).toString('hex')
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest()
}

function toB64Url(buffer) {
    return Buffer.from(buffer)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
}

function isWebP(buffer) {
    return buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
}

function isAnimatedWebP(buffer) {
    if (!isWebP(buffer)) return false

    let offset = 12

    while (offset < buffer.length - 8) {
        const chunk = buffer.toString('ascii', offset, offset + 4)
        const size = buffer.readUInt32LE(offset + 4)

        if (chunk === 'VP8X' && (buffer[offset + 8] & 0x02)) return true
        if (chunk === 'ANIM' || chunk === 'ANMF') return true

        offset += 8 + size + (size % 2)
    }

    return false
}

function classifySticker(buffer, stickerMessage) {
    if (stickerMessage.isLottie) {
        return { ext: 'json', mimetype: 'application/json', isAnimated: true, isLottie: true }
    }

    return { ext: 'webp', mimetype: 'image/webp', isAnimated: isAnimatedWebP(buffer), isLottie: false }
}

async function downloadStickerBuffer(stickerMessage) {
    const stream = await downloadContentFromMessage(stickerMessage, 'sticker')
    const chunks = []
    for await (const chunk of stream) {
        chunks.push(chunk)
    }
    return Buffer.concat(chunks)
}

// Coba pakai sharp kalau terpasang (hasil terbaik: resize 252x252 rapi).
// Kalau sharp gak ada (mis. gagal install di Termux/ARM), fallback pakai
// buffer asli apa adanya supaya fitur tetap jalan walau tray/thumbnail
// tidak diresize sempurna.
async function tryGetSharp() {
    try {
        const mod = await import('sharp')
        return mod.default
    } catch {
        return null
    }
}

async function makeTrayWebp(buffer) {
    const sharp = await tryGetSharp()
    if (!sharp) return buffer // fallback: pakai buffer asli apa adanya

    return await sharp(buffer, { animated: false })
        .resize(252, 252, { fit: 'cover' })
        .webp()
        .toBuffer()
}

async function makeBlankTrayWebp() {
    const sharp = await tryGetSharp()
    if (!sharp) {
        // Fallback minimal: webp 1x1 transparan valid, biar tidak crash.
        return Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')
    }

    return await sharp({
        create: { width: 252, height: 252, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).webp().toBuffer()
}

async function makeThumbnailJpeg(buffer) {
    const sharp = await tryGetSharp()
    if (!sharp) return buffer // fallback: pakai buffer webp asli (WA biasanya masih terima)

    return await sharp(buffer)
        .resize(252, 252, { fit: 'cover' })
        .jpeg()
        .toBuffer()
}

async function uploadToServer(sock, buffer, { hkdf, mediaPath, mediaKey = crypto.randomBytes(32) }) {
    const expanded = Buffer.from(
        crypto.hkdfSync('sha256', mediaKey, Buffer.alloc(32), Buffer.from(hkdf), 112),
    )

    const iv = expanded.subarray(0, 16)
    const cipherKey = expanded.subarray(16, 48)
    const macKey = expanded.subarray(48, 80)

    const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv)
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()])

    const mac = crypto
        .createHmac('sha256', macKey)
        .update(iv)
        .update(encrypted)
        .digest()
        .subarray(0, 10)

    const encBuffer = Buffer.concat([encrypted, mac])

    const fileSha256 = sha256(buffer)
    const fileEncSha256 = sha256(encBuffer)

    const iq = await sock.query({
        tag: 'iq',
        attrs: {
            id: sock.generateMessageTag?.() ?? Date.now().toString(),
            to: 's.whatsapp.net',
            type: 'set',
            xmlns: 'w:m',
        },
        content: [{ tag: 'media_conn', attrs: {} }],
    })

    const mediaConn = iq.content?.find(v => v.tag === 'media_conn')
    if (!mediaConn) throw new Error('media_conn tidak ditemukan')

    const auth = mediaConn.attrs?.auth
    if (!auth) throw new Error('auth media_conn tidak ditemukan')

    const hosts = (mediaConn.content || [])
        .filter(v => v.tag === 'host')
        .map(v => v.attrs?.hostname)
        .filter(Boolean)

    if (!hosts.length) throw new Error('host upload tidak ditemukan')

    const token = encodeURIComponent(
        fileEncSha256.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''),
    )

    let lastError

    for (const host of hosts) {
        try {
            const json = await new Promise((resolve, reject) => {
                const url = new URL(
                    `https://${host}${mediaPath}/${token}?auth=${encodeURIComponent(auth)}&token=${token}`,
                )

                const req = https.request(
                    {
                        hostname: url.hostname,
                        port: 443,
                        path: url.pathname + url.search,
                        method: 'POST',
                        headers: {
                            Origin: 'https://web.whatsapp.com',
                            Referer: 'https://web.whatsapp.com/',
                            'Content-Type': 'application/octet-stream',
                            'Content-Length': encBuffer.length,
                        },
                    },
                    (res) => {
                        let body = ''
                        res.on('data', c => body += c)
                        res.on('end', () => {
                            if (res.statusCode < 200 || res.statusCode >= 300) {
                                return reject(new Error(`Upload gagal ${res.statusCode}: ${body}`))
                            }
                            try {
                                resolve(JSON.parse(body))
                            } catch {
                                reject(new Error(`Response bukan JSON: ${body}`))
                            }
                        })
                    },
                )

                req.on('error', reject)
                req.write(encBuffer)
                req.end()
            })

            const directPath = json.direct_path ?? json.directPath ?? json.url ?? json.path
            if (!directPath) throw new Error('directPath tidak ditemukan')

            return {
                mediaKey,
                fileLength: buffer.length,
                fileSha256,
                fileEncSha256,
                directPath,
                ...json,
            }
        } catch (e) {
            lastError = e
        }
    }

    throw lastError ?? new Error('Semua host upload gagal')
}

async function sendCustomStickerPack(sock, m, pack, config) {
    const zip = new AdmZip()
    const stickersMetadata = []

    for (const item of pack) {
        const fileName = `${toB64Url(sha256(item.buffer))}.${item.ext}`
        zip.addFile(fileName, item.buffer)

        stickersMetadata.push({
            fileName,
            isAnimated: item.isAnimated,
            emojis: [''],
            accessibilityLabel: '',
            isLottie: item.isLottie,
            mimetype: item.mimetype,
        })
    }

    const trayIconFileName = 'tray_icon.webp'
    const traySource = pack.find(v => !v.isLottie)?.buffer

    const trayBuffer = traySource
        ? await makeTrayWebp(traySource)
        : await makeBlankTrayWebp()

    zip.addFile(trayIconFileName, trayBuffer)

    const archive = zip.toBuffer()

    const packUpload = await uploadToServer(sock, archive, {
        hkdf: 'WhatsApp Sticker Pack Keys',
        mediaPath: '/mms/sticker-pack',
    })

    const thumbnailBuffer = await makeThumbnailJpeg(trayBuffer)

    const thumbUpload = await uploadToServer(sock, thumbnailBuffer, {
        hkdf: 'WhatsApp Sticker Pack Thumbnail Keys',
        mediaPath: '/mms/thumbnail-sticker-pack',
        mediaKey: packUpload.mediaKey,
    })

    await sock.relayMessage(
        m.from,
        {
            messageContextInfo: {
                messageSecret: crypto.randomBytes(32),
            },
            stickerPackMessage: {
                stickerPackId: 'Pack_' + crypto.randomBytes(8).toString('hex'),
                name: config.botName || 'MaoMao',
                publisher: config.botName || 'MaoMao',
                packDescription: `Sticker pack dibuat menggunakan ${config.botName || 'MaoMao'}`,

                stickers: stickersMetadata,

                fileLength: packUpload.fileLength,
                fileSha256: packUpload.fileSha256,
                fileEncSha256: packUpload.fileEncSha256,
                mediaKey: packUpload.mediaKey,
                directPath: packUpload.directPath,
                mediaKeyTimestamp: Math.floor(Date.now() / 1000),
                stickerPackSize: packUpload.fileLength,
                stickerPackOrigin: 2,

                trayIconFileName,
                thumbnailDirectPath: thumbUpload.directPath,
                thumbnailSha256: thumbUpload.fileSha256,
                thumbnailEncSha256: thumbUpload.fileEncSha256,
                thumbnailHeight: 252,
                thumbnailWidth: 252,
                imageDataHash: thumbUpload.fileSha256.toString('base64'),
            },
        },
        { quoted: m },
    )
}

export default {
    cmd: ['tspk', 'addtspk', 'deltspk'],
    category: 'sticker',
    run: async (m, { sock, config }) => {
        const sender = m.sender
        const index = loadPackIndex(sender)

        const command = (m.text || m.body || '').trim().split(/\s+/)[0].replace(/^[.!/#]/, '').toLowerCase()

        if (command === 'tspk') {
            if (!index.length) {
                return m.reply('Pack masih kosong, tambahkan dulu dengan .addtspk (reply sticker)')
            }

            try {
                // Muat ulang buffer tiap sticker dari disk sebelum dikirim
                const pack = index.map(item => ({
                    ...item,
                    buffer: loadStickerBuffer(sender, item.mediaName, item.ext),
                }))

                await sendCustomStickerPack(sock, m, pack, config)
            } catch (e) {
                console.error('[tspk] Gagal kirim pack:', e)
                m.reply(`Gagal membuat/mengirim sticker pack: ${e.message}`)
            }
            return
        }

        // addtspk & deltspk butuh reply sticker
        const stickerMessage = m.quoted?.stickerMessage

        if (!stickerMessage) {
            return m.reply('Reply sticker yang mau diproses.')
        }

        const sha256Hex = sha256Of(stickerMessage)

        if (command === 'addtspk') {
            if (index.some(v => v.sha256 === sha256Hex)) {
                return m.reply('Sticker sudah ada di pack.')
            }

            try {
                const buffer = await downloadStickerBuffer(stickerMessage)
                if (!buffer) return m.reply('Gagal download sticker.')

                const type = classifySticker(buffer, stickerMessage)
                const mediaName = getNextMediaName(index)

                saveStickerBuffer(sender, mediaName, type.ext, buffer)
                index.push({ sha256: sha256Hex, mediaName, ...type })
                savePackIndex(sender, index)

                const label = type.isLottie ? 'lottie' : type.isAnimated ? 'animated' : 'static'
                return m.reply(`Ditambahkan sebagai *${mediaName}* (${label}). Total ${index.length} sticker di pack.`)
            } catch (e) {
                console.error('[addtspk] Gagal:', e)
                return m.reply(`Gagal menambahkan sticker: ${e.message}`)
            }
        }

        if (command === 'deltspk') {
            const idx = index.findIndex(v => v.sha256 === sha256Hex)

            if (idx === -1) {
                return m.reply('Sticker tidak ditemukan di pack.')
            }

            const [removed] = index.splice(idx, 1)
            deleteStickerFile(sender, removed.mediaName, removed.ext)
            savePackIndex(sender, index)

            return m.reply(`Dihapus. Sisa ${index.length} sticker di pack.`)
        }
    }
}