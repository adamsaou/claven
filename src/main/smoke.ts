import type { BrowserWindow } from 'electron'

type Check = { name: string; pass: boolean; detail: string }

/**
 * Headless proof that the IPC contract holds end to end.
 *
 * Everything runs via executeJavaScript in the real renderer, so it exercises
 * the actual path -- renderer -> contextBridge -> preload -> ipcMain -> back --
 * rather than calling the handler directly and proving nothing about the bridge.
 *
 * Run with: npm run smoke
 */
export async function runSmokeTest(window: BrowserWindow): Promise<number> {
  const checks: Check[] = []

  const evaluate = async <T>(expression: string): Promise<T> =>
    (await window.webContents.executeJavaScript(expression)) as T

  // 1. A declared channel completes a full round trip.
  const ping = await evaluate<{ ok: boolean; value?: { pid: number; sentAt: number } }>(
    `window.claven.invoke('app:ping', { sentAt: Date.now() })`
  )
  checks.push({
    name: 'app:ping round trip',
    pass: ping.ok === true && typeof ping.value?.pid === 'number',
    detail: ping.ok ? `main pid ${ping.value?.pid}` : 'invoke returned not-ok'
  })

  // 2. The request payload survives intact, not just "something came back".
  const echo = await evaluate<{ ok: boolean; value?: { sentAt: number } }>(
    `window.claven.invoke('app:ping', { sentAt: 1234567890 })`
  )
  checks.push({
    name: 'request payload preserved',
    pass: echo.ok === true && echo.value?.sentAt === 1234567890,
    detail: `sentAt came back as ${String(echo.value?.sentAt)}`
  })

  // 3. An undeclared channel is refused by the preload allowlist.
  const blocked = await evaluate<{ ok: boolean; error?: { code?: string } }>(
    `window.claven.invoke('fs:readFile', { path: 'anything' })`
  )
  checks.push({
    name: 'off-contract channel blocked',
    pass: blocked.ok === false && blocked.error?.code === 'BLOCKED_CHANNEL',
    detail: blocked.ok ? 'ALLOWED — allowlist is broken' : `rejected as ${blocked.error?.code}`
  })

  // 4. The renderer has no Node reach. If this ever fails, the sandbox is off.
  const leak = await evaluate<string>(
    `[typeof require, typeof module, typeof process, typeof window.ipcRenderer].join(',')`
  )
  checks.push({
    name: 'renderer has no node access',
    pass: leak === 'undefined,undefined,undefined,undefined',
    detail: `[require, module, process, ipcRenderer] = ${leak}`
  })

  // 5. The bridge exposes exactly one method, not a general-purpose escape hatch.
  const surface = await evaluate<string>(`Object.keys(window.claven).sort().join(',')`)
  checks.push({
    name: 'bridge surface is minimal',
    pass: surface === 'invoke',
    detail: `window.claven = { ${surface} }`
  })

  let failures = 0
  for (const check of checks) {
    if (!check.pass) failures += 1
    console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}  —  ${check.detail}`)
  }
  console.log(
    failures === 0
      ? `\n${checks.length}/${checks.length} passed`
      : `\n${failures} of ${checks.length} FAILED`
  )
  return failures
}
