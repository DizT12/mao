const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export default {
    cmd: ['balapan', 'balapankuda', 'race'],
    category: 'games',
    run: async (m, { sock, text, config }) => {
        const animals = ['🦓', '🐅', '🦏', '🐪', '🦛', '🦬', '🐃', '🐂', '🐎', '🐏']
        const trackLength = 25
        
        const bet = parseInt(text)
        if (isNaN(bet) || bet < 1 || bet > 10) {
            let help = `⌗ *Balapan Kuda*\n\n`
            help += `Pilih nomor kuda (1-10) untuk bertaruh!\n`
            help += `Contoh: .balapan 5\n\n`
            animals.forEach((emoji, i) => {
                help += `${i + 1}. ${emoji}\n`
            })
            return m.reply(help)
        }

        const playerBet = bet - 1
        let positions = new Array(animals.length).fill(0)
        let finished = false
        let winnerIndex = -1

        let { key } = await sock.sendMessage(m.from, { text: '🏁 Bersiap... Balapan akan segera dimulai!' }, { quoted: m })

        while (!finished) {
            await delay(1500)
            
            let trackView = `[ *BALAPAN KUDA SEDANG BERLANGSUNG* ]\n\n`
            
            for (let i = 0; i < animals.length; i++) {
                positions[i] += Math.floor(Math.random() * 4)
                
                if (positions[i] >= trackLength) {
                    positions[i] = trackLength
                    if (!finished) {
                        finished = true
                        winnerIndex = i
                    }
                }

                const progress = '-'.repeat(positions[i])
                const remaining = '-'.repeat(trackLength - positions[i])
                trackView += `${i + 1}. ${progress}${animals[i]}${remaining} 🏁\n`
            }

            trackView += `\n> *Pilihan Kamu:* ${animals[playerBet]}\n`
            trackView += `> *${config.botName}*`

            await sock.sendMessage(m.from, { text: trackView, edit: key })
        }

        await delay(1000)
        const isWin = playerBet === winnerIndex
        let resultText = `⌗ *HASIL BALAPAN*\n\n`
        resultText += `Pemenangnya adalah: *${animals[winnerIndex]}* (Nomor ${winnerIndex + 1})\n\n`
        
        if (isWin) {
            resultText += `🎉 Selamat! Kamu menang! Pilihanmu ${animals[playerBet]} sampai pertama.`
        } else {
            resultText += `❌ Yahh kalah... Pilihanmu ${animals[playerBet]} tertinggal di belakang.`
        }

        return m.reply(resultText)
    }
}