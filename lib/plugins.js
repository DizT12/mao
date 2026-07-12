import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginFolder = path.join(__dirname, '../plugins')
export const plugins = new Map()
const fileCache = new Map()

function getAllFiles(dir, files = []) {
    fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file)
        if (fs.statSync(fullPath).isDirectory()) {
            getAllFiles(fullPath, files)
        } else if (file.endsWith('.js')) {
            files.push(fullPath)
        }
    })
    return files
}

export async function loadPlugins() {
    plugins.clear()
    fileCache.clear()
    const files = getAllFiles(pluginFolder)
    
    let success = 0
    let failed = 0

    console.log(chalk.cyan('⟳ Loading plugins...'))

    for (const fullPath of files) {
        let relativePath = path.relative(pluginFolder, fullPath)
        try {
            const content = fs.readFileSync(fullPath, 'utf-8')
            fileCache.set(relativePath, content)

            const module = await import(`../plugins/${relativePath.replace(/\\/g, '/')}?update=${Date.now()}`)
            const plugin = module.default || module
            if (plugin && plugin.cmd) {
                plugins.set(relativePath, plugin)
                success++
            }
        } catch (e) {
            console.error(chalk.red(`✖ Error loading ${relativePath}: ${e.message.split('\n')[0]}`))
            failed++
        }
    }

    console.log(chalk.bold('┌─────────────────────────────┐'))
    console.log(`${chalk.bold('│')}  ${chalk.greenBright(`✓ Success: ${success}`.padEnd(12))} ${chalk.redBright(`✖ Failed: ${failed}`.padEnd(11))} ${chalk.bold('  │')}`)
    console.log(chalk.bold('└─────────────────────────────┘'))
}

export async function reloadPlugin(relativePath) {
    try {
        const fullPath = path.join(pluginFolder, relativePath)
        if (!fs.existsSync(fullPath)) return

        const oldContent = fileCache.get(relativePath) || ''
        const newContent = fs.readFileSync(fullPath, 'utf-8')
        fileCache.set(relativePath, newContent)

        const oldLines = oldContent.split('\n')
        const newLines = newContent.split('\n')
        
        const added = newLines.filter(x => !oldLines.includes(x)).length
        const removed = oldLines.filter(x => !newLines.includes(x)).length

        const module = await import(`../plugins/${relativePath.replace(/\\/g, '/')}?update=${Date.now()}`)
        const plugin = module.default || module
        
        if (plugin && plugin.cmd) {
            plugins.set(relativePath, plugin)
            console.log(chalk.bold('[ RELOAD ]'), chalk.yellow(relativePath), chalk.green(`+${added}`), chalk.red(`-${removed}`))
        }
    } catch (e) {
        console.error(chalk.bgRed.white.bold(` FAIL TO RELOAD ${relativePath} `), chalk.yellow(e.message))
    }
}

export function getPlugin(command) {
    for (const [file, plugin] of plugins) {
        if (plugin.cmd.includes(command)) return plugin
    }
    return null
}