# App "Send" to a bot address silently withdraws to Shannon, not Hideki

Severity: major
Area: app

## Steps to reproduce
1. Sign in at app.testnet.dreamdex.io, join Perps Arena (Wallet 1 receives STT on Hideki).
2. Create a fresh bot key (EOA) to trade perps on Hideki.
3. Wallet menu > Wallet 1 > **Send** tab. TO = bot address, AMOUNT = 2, token STT. Hold to send.
4. Check the bot's STT balance on Hideki (chain 50383) and on Shannon (chain 50312).

## Expected
Either the 2 STT arrive on Hideki (the chain the perps and the bot use), or the Send screen
clearly says the destination is a different network (Shannon) before sending.

## Actual
- The send screen only warns "Leaving your wallets - a send can't be undone". No destination network is shown.
- Activity shows **"Withdrawal of 2.00 STT - To Somnia"**.
- Balances afterwards:
  - Hideki (50383): bot **0 STT**, Wallet 1 17.312 STT
  - Shannon (50312): bot **2 STT**, Wallet 1 0 STT
- The bot then cannot send any tx on Hideki (`account does not exist`), see #2.
- Using **Link a bot > "Send it 5 STT for gas"** instead delivers gas on Hideki correctly.

## Evidence
- `node balance.mjs` output (above), Activity screenshot "Withdrawal of 2.00 STT / To Somnia".
- Bot: `0x26421030A92Bb1e96C6E0137b004AA583b463388`
- Wallet 1: `0xbECd3f4f8Fe8a0A69AC7c04c193aB49a47375c2b`

## Environment
app.testnet.dreamdex.io (DreamDEX region), MetaMask login, Chrome on Windows, 2026-10-24.
