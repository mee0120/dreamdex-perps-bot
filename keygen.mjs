// Create a fresh bot key in .env (chmod 600). Prints only the address.
import { existsSync, writeFileSync, chmodSync } from "fs"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"

if (existsSync(".env")) {
  console.log(".env already exists - not overwriting")
  process.exit(1)
}
const pk = generatePrivateKey()
const addr = privateKeyToAccount(pk).address
writeFileSync(".env", `PRIVATE_KEY=${pk}\nBOT_ADDRESS=${addr}\nOWNER_ADDRESS=\n`)
chmodSync(".env", 0o600)
console.log("bot address:", addr)
