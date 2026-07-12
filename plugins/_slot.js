const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export default {
    cmd: ['judi', 'slot'],
    category: 'games',
    run: async (m, { sock, text, config }) => {
        const bet = parseInt(text)
        if (!bet || bet < 1) {
            return m.reply('🎰 *JUDI SLOT*\n\nMasukan jumlah taruhan!\nContoh: .judi 100')
        }

        const fruits = ['🍎', '🍊', '🍇', '🍒', '🍋', '🍉', '⭐', '🔔', '💎']
        const getDisplay = (r1, r2, r3) => `🎰 *SLOT MACHINE* 🎰\n\n      [ ${r1} | ${r2} | ${r3} ]\n\n`
        
        const chance = Math.random() * 100
        let finalReels = []
        if (chance < 10) {
            let win = fruits[Math.floor(Math.random() * fruits.length)]
            finalReels = [win, win, win]
        } else if (chance < 40) {
            let win = fruits[Math.floor(Math.random() * fruits.length)]
            let lose = fruits.filter(f => f !== win)[Math.floor(Math.random() * (fruits.length - 1))]
            finalReels = [win, win, lose].sort(() => Math.random() - 0.5)
        } else {
            finalReels = fruits.sort(() => Math.random() - 0.5).slice(0, 3)
            if (finalReels[0] === finalReels[1] || finalReels[1] === finalReels[2] || finalReels[0] === finalReels[2]) {
                finalReels = ['🍎', '💎', '🍒']
            }
        }

        let { key } = await sock.sendMessage(m.from, { text: '🎰 *SPINNING...*' }, { quoted: m })

        for (let i = 0; i < 3; i++) {
            await sock.sendMessage(m.from, { 
                text: getDisplay(fruits[Math.floor(Math.random() * 9)], fruits[Math.floor(Math.random() * 9)], fruits[Math.floor(Math.random() * 9)]) + '_Spinning..._', 
                edit: key 
            })
            await delay(400)
        }

        await sock.sendMessage(m.from, { 
            text: getDisplay(finalReels[0], fruits[Math.floor(Math.random() * 9)], fruits[Math.floor(Math.random() * 9)]) + '_Reel 1 Berhenti..._', 
            edit: key 
        })
        await delay(500)

        await sock.sendMessage(m.from, { 
            text: getDisplay(finalReels[0], finalReels[1], fruits[Math.floor(Math.random() * 9)]) + '_Reel 2 Berhenti..._', 
            edit: key 
        })
        await delay(500)

        const isJackpot = finalReels[0] === finalReels[1] && finalReels[1] === finalReels[2]
        const isDouble = (finalReels[0] === finalReels[1]) || (finalReels[1] === finalReels[2]) || (finalReels[0] === finalReels[2])

        let status = ''
        let prize = 0

        if (isJackpot) {
            status = '🎉 *JACKPOT!!!* 🎉'
            prize = bet * 10
        } else if (isDouble) {
            status = '✨ *MENANG (2 SAME)* ✨'
            prize = Math.floor(bet * 1.5)
        } else {
            status = '❌ *KALAH* ❌'
            prize = 0
        }

        let result = getDisplay(finalReels[0], finalReels[1], finalReels[2])
        result += `${status}\n\n`
        result += prize > 0 ? `Kamu mendapatkan: *${prize}* 🪙` : `Kamu kehilangan: *${bet}* 🪙`
        result += `\n\n> *${config.botName}*`

        return await sock.sendMessage(m.from, { text: result, edit: key })
    }
}