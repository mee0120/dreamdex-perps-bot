// STT balances of the bot and the owner wallet on both Somnia testnets
import { readFileSync } from "fs"
import { createPublicClient, http, formatEther } from "viem"

const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
)
const chains = [
  ["Hideki (dreamDEX perps)", "https://api.hideki2.infra.testnet.somnia.network"],
  ["Somnia Shannon testnet ", "https://dream-rpc.somnia.network"],
]
const addrs = [["bot  ", env.BOT_ADDRESS], ["owner", env.OWNER_ADDRESS]].filter(([, a]) => a)
for (const [cname, url] of chains) {
  try {
    const c = createPublicClient({ transport: http(url) })
    console.log(`\n== ${cname}  chainId=${await c.getChainId()}`)
    for (const [n, a] of addrs) console.log(`  ${n} ${a} ${formatEther(await c.getBalance({ address: a }))} STT`)
  } catch (e) {
    console.log(`\n== ${cname}  failed: ${e.shortMessage || e.message}`)
  }
}
process.exit(0)
