// Cancel the owner's resting perp orders from the linked bot (cancelOrderFor).
//
// Lists the owner's open orders on-chain for one market, simulates cancelOrderFor
// for each, and (with --send) cancels them.
//
// Usage: node cancel_for.mjs           (dry run: list + simulate)
//        node cancel_for.mjs --send    (cancel)
// Options: SYMBOL=BTC (default)  ORDER_ID=<id> to cancel only one order

import { readFileSync } from "fs"
import { createPublicClient, createWalletClient, http, parseEventLogs, decodeErrorResult } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets, contractErrorsAbi, orderBookEventsAbi, perpPoolEventsAbi } from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"

const SEND = process.argv.includes("--send")
const SYMBOL = process.env.SYMBOL || "BTC"
const RPC = "https://api.hideki2.infra.testnet.somnia.network"
const EXPLORER = "https://explorer.testnet.somnia.network/tokyo"

const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
)
const owner = env.OWNER_ADDRESS
const account = privateKeyToAccount(env.PRIVATE_KEY)
const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) })
const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC), account })
const markets = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
})
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))

// selector 0xe37b444b, the CANCEL_ORDER_FOR_SELECTOR the SDK exports
const cancelOrderForAbi = [{
  type: "function", name: "cancelOrderFor", stateMutability: "nonpayable",
  inputs: [{ name: "owner", type: "address" }, { name: "orderId", type: "uint128" }], outputs: [],
}]

const m = (await markets.client.listPerpMarkets()).find((x) => x.baseSymbol === SYMBOL)
console.log(`${SYMBOL}-PERP pool=${m.poolAddress}  owner=${owner}  bot=${account.address}`)

// 1) on-chain open orders of the owner
let ids = await markets.client.getOwnOpenOrdersOnchain(m.poolAddress, owner)
console.log(`on-chain open orders: ${ids.length ? ids.map(String).join(", ") : "none"}`)

// 2) indexer view, to compare
try {
  const idx = await markets.client.getOpenOrders(owner)
  console.log(`indexer open orders (all markets): ${idx.length}`)
  for (const o of idx) console.log("  ", json(o).slice(0, 300))
} catch (e) {
  console.log("indexer getOpenOrders failed:", e.shortMessage || e.message)
}

if (process.env.ORDER_ID) ids = ids.filter((id) => String(id) === process.env.ORDER_ID)
if (!ids.length) { console.log("nothing to cancel"); process.exit(0) }

for (const id of ids) {
  const args = [owner, id]
  try {
    await pub.simulateContract({ address: m.poolAddress, abi: cancelOrderForAbi, functionName: "cancelOrderFor", args, account, gas: 5_000_000n })
    console.log(`simulate cancelOrderFor(${id}): OK`)
  } catch (e) {
    const data = e?.walk?.((x) => typeof x?.data === "string")?.data
    let name = e.shortMessage
    try { if (data) name = decodeErrorResult({ abi: contractErrorsAbi, data }).errorName } catch { name = `unknown selector ${String(data).slice(0, 10)}` }
    console.log(`simulate cancelOrderFor(${id}): REVERTS -> ${name}`)
    continue
  }
  if (!SEND) continue
  const hash = await wallet.writeContract({ address: m.poolAddress, abi: cancelOrderForAbi, functionName: "cancelOrderFor", args, gas: 5_000_000n })
  const rc = await pub.waitForTransactionReceipt({ hash })
  const evs = parseEventLogs({ abi: [...orderBookEventsAbi, ...perpPoolEventsAbi], logs: rc.logs })
  console.log(`cancelled ${id}: status=${rc.status} gasUsed=${rc.gasUsed} events=${evs.map((e) => e.eventName).join(",")}`)
  console.log(`  ${EXPLORER}/tx/${hash}`)
}

if (SEND) {
  const after = await markets.client.getOwnOpenOrdersOnchain(m.poolAddress, owner)
  console.log(`on-chain open orders after: ${after.length ? after.map(String).join(", ") : "none"}`)
}
if (!SEND) console.log("\nDRY RUN - nothing sent. Re-run with --send.")
process.exit(0)
