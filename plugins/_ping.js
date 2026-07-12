export default {
    cmd: ['ping'],
    category: 'info',
    run: async (m, { sock, config }) => {
        const latency = Date.now() - m.messageTimestamp * 1000
        await m.reply(`Pong! Latency: ${latency}ms\nBot: ${config.botName}`)
    }
}