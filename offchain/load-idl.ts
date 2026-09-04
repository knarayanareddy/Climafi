// Loads the generated Anchor IDL (target/idl/nimbus.json) for offchain services.
//
// `anchor build` writes the canonical IDL, so offchain services should consume it
// rather than a hand-maintained copy. This guarantees instruction names, account
// names, and enum/arg serialization always match the deployed program.

import * as fs from 'fs'
import * as path from 'path'

export function loadProgramIdl(): any {
  const candidates = [
    path.join(__dirname, '..', 'target', 'idl', 'nimbus.json'),
    path.join(process.cwd(), 'target', 'idl', 'nimbus.json'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    }
  }
  throw new Error(
    'No IDL found at target/idl/nimbus.json. Run `anchor build` first — ' +
    'offchain services load the generated IDL to stay in sync with the deployed program.'
  )
}
