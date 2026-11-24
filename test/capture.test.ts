import { expect, test, describe } from 'bun:test'
import {
  fitWithin,
  toGrey,
  meanAbsDiff,
  frameChanged,
  base64ByteLength,
  dataUrlToBase64,
  formatBytes,
  describeSupport,
  TICK_WORKER_SOURCE,
  DEFAULT_CAPTURE_SETTINGS,
  type CaptureEnvironment,
  chatLooksUp,
} from '../src/capture.ts'

describe('fitWithin', () => {
  test('leaves small frames alone', () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 })
  })

  test('scales a 4K frame down to the long edge', () => {
    expect(fitWithin(3840, 2160, 1280)).toEqual({ width: 1280, height: 720 })
  })

  test('works for portrait frames too', () => {
    expect(fitWithin(1080, 2400, 1280)).toEqual({ width: 576, height: 1280 })
  })

  test('never scales up', () => {
    expect(fitWithin(320, 240, 1280)).toEqual({ width: 320, height: 240 })
  })

  test('a nonsense maxEdge means no scaling', () => {
    expect(fitWithin(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 })
    expect(fitWithin(1920, 1080, NaN)).toEqual({ width: 1920, height: 1080 })
  })

  test('zero input stays zero rather than exploding', () => {
    expect(fitWithin(0, 0, 1280)).toEqual({ width: 0, height: 0 })
  })

  test('an extreme aspect ratio still gets at least one pixel', () => {
    expect(fitWithin(10000, 1, 100).height).toBe(1)
  })
})

describe('change gate', () => {
  const grey = (v: number, n = 4) => new Uint8Array(n).fill(v)

  test('toGrey uses luma weights', () => {
    // Pure red, green, blue, white.
    const rgba = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]
    expect(Array.from(toGrey(rgba))).toEqual([76, 150, 29, 255])
  })

  test('identical frames differ by zero', () => {
    expect(meanAbsDiff(grey(100), grey(100))).toBe(0)
  })

  test('mean absolute difference is what it says', () => {
    expect(meanAbsDiff(new Uint8Array([0, 10, 20, 30]), new Uint8Array([10, 10, 10, 10]))).toBe(10)
  })

  test('differently sized frames count as fully changed', () => {
    expect(meanAbsDiff(grey(0, 4), grey(0, 9))).toBe(255)
    expect(meanAbsDiff(new Uint8Array(0), grey(0))).toBe(255)
  })

  test('the first frame always passes', () => {
    expect(frameChanged(null, grey(0), 6)).toEqual({ changed: true, diff: 255 })
  })

  test('a static screen is skipped, a moving one is sent', () => {
    expect(frameChanged(grey(100), grey(103), 6).changed).toBe(false)
    expect(frameChanged(grey(100), grey(120), 6).changed).toBe(true)
  })

  test('a threshold of zero disables the gate but still reports the diff', () => {
    expect(frameChanged(grey(100), grey(100), 0)).toEqual({ changed: true, diff: 0 })
  })
})

describe('payload accounting', () => {
  test('base64ByteLength matches the real decoded size', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 299_999, 300_000]) {
      const bytes = new Uint8Array(n).map((_, i) => i % 251)
      const b64 = Buffer.from(bytes).toString('base64')
      expect(base64ByteLength(b64)).toBe(n)
    }
  })

  test('dataUrlToBase64 strips the prefix and leaves bare base64 alone', () => {
    expect(dataUrlToBase64('data:image/jpeg;base64,AAAA')).toBe('AAAA')
    expect(dataUrlToBase64('AAAA')).toBe('AAAA')
  })

  test('formatBytes is readable', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(287 * 1024)).toBe('287 KB')
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })
})

describe('describeSupport', () => {
  const base: CaptureEnvironment = {
    isSecureContext: true,
    hasGetDisplayMedia: true,
    clientKind: 'browser',
    platform: 'windows',
    desktopCaptureCapability: 0,
    hasDocumentPictureInPicture: true,
  }

  test('a normal desktop browser is supported with no note', () => {
    expect(describeSupport(base)).toEqual({ screen: true, note: '' })
  })

  test('plain http over the LAN hides capture and says why', () => {
    const s = describeSupport({ ...base, isSecureContext: false, hasGetDisplayMedia: false })
    expect(s.screen).toBe(false)
    expect(s.note).toContain('secure page (https or localhost)')
  })

  test('a desktop web view without the API is told to use a browser', () => {
    const s = describeSupport({ ...base, clientKind: 'desktop', hasGetDisplayMedia: false })
    expect(s.screen).toBe(false)
    expect(s.note).toContain('Open Lumiverse in a browser')
  })

  test('the desktop app with the API gets a caveat, not a block', () => {
    const s = describeSupport({ ...base, clientKind: 'desktop' })
    expect(s.screen).toBe(true)
    expect(s.note).toContain('desktop app')
  })

  test('phones are pointed at the camera', () => {
    const s = describeSupport({ ...base, clientKind: 'mobile', hasGetDisplayMedia: false })
    expect(s.screen).toBe(false)
    expect(s.note).toContain('camera')
  })
})

describe('tick worker', () => {
  test('the worker source is self-contained and only posts ticks', () => {
    expect(TICK_WORKER_SOURCE).toContain('setInterval')
    expect(TICK_WORKER_SOURCE).toContain("type: 'tick'")
    // No network, no imports, nothing but a timer.
    expect(TICK_WORKER_SOURCE).not.toMatch(/fetch|import|XMLHttpRequest|WebSocket/)
  })

  test('the worker source parses as JavaScript', () => {
    expect(() => new Function(TICK_WORKER_SOURCE)).not.toThrow()
  })
})

describe('defaults', () => {
  test('match plan-v2 §12', () => {
    expect(DEFAULT_CAPTURE_SETTINGS).toMatchObject({
      captureMode: 'on-demand',
      cadenceSeconds: 5,
      autoStopMinutes: 30,
      maxEdge: 1280,
      jpegQuality: 0.7,
      thumbEdge: 320,
      excludeSelf: true,
      monitorSurfaces: 'allow',
    })
  })
})

describe('sources (Phase 3)', () => {
  test('isCaptureSource accepts the five sources and nothing else', async () => {
    const { isCaptureSource } = await import('../src/capture.ts')
    for (const s of ['screen', 'webcam', 'camera', 'file', 'synthetic']) expect(isCaptureSource(s)).toBe(true)
    expect(isCaptureSource('clipboard')).toBe(false)
    expect(isCaptureSource(undefined)).toBe(false)
  })
})

describe('titleCandidate (D15 layer 1)', () => {
  const { titleCandidate } = require('../src/capture.ts') as typeof import('../src/capture.ts')
  test('ids and empties are not candidates', () => {
    expect(titleCandidate('window:1578432:0')).toBeNull()
    expect(titleCandidate('screen:0:0')).toBeNull()
    expect(titleCandidate('web-contents-media-stream://6:8')).toBeNull()
    expect(titleCandidate('')).toBeNull()
    expect(titleCandidate('Kg3Hc9vxfJ72mR5i8BxkxILBh23uMdEV')).toBeNull()
    expect(titleCandidate('htSe3eMsOmSbjwmyUuX+zwamWphIsg9Esul8af5DKv86/3MG')).toBeNull()
    expect(titleCandidate('Palworld')).toBe('Palworld')
  })
  test('titles are, with the browser suffix stripped', () => {
    expect(titleCandidate('Going Medieval')).toBe('Going Medieval')
    expect(titleCandidate('Courtenay, BC - 7 Day Forecast - Environment Canada — Mozilla Firefox')).toBe('Courtenay, BC - 7 Day Forecast - Environment Canada')
    expect(titleCandidate('Docs - Google Chrome')).toBe('Docs')
    expect(titleCandidate('Thing - Microsoft Edge')).toBe('Thing')
    expect(titleCandidate('Some Very Long Window Title '.repeat(6))!.length).toBe(80)
    expect(titleCandidate('x'.repeat(100))).toBeNull() // no spaces in 20+ characters reads as an opaque id
  })
})

describe('progressText', () => {
  test('says who is writing, and where in the box they are', async () => {
    const { progressText } = await import('../src/capture.ts')
    expect(progressText({ phase: 'seeing' })).toBe('Reading the picture…')
    expect(progressText({ phase: 'searching' })).toBe('Looking things up…')
    expect(progressText({ phase: 'writing', name: 'Marlo Finch' })).toBe('Marlo Finch is writing…')
    expect(progressText({ phase: 'writing', name: 'Wren', seat: 1, of: 4 })).toBe('Wren is writing (1 of 4)…')
    expect(progressText({ phase: 'writing', name: 'Ottilie', seat: 3, of: 4 })).toBe('Ottilie is answering (3 of 4)…')
    expect(progressText({ phase: 'writing' })).toBe('The character is writing…')
  })
})

describe('clampPct', () => {
  test('a saved percentage, kept in range; nonsense becomes the default', async () => {
    const { clampPct } = await import('../src/capture-tab.ts')
    expect(clampPct(40, 25, 10, 90)).toBe(40)
    expect(clampPct(200, 25, 10, 90)).toBe(90)
    expect(clampPct(undefined, 25, 10, 90)).toBe(25)
    expect(clampPct('x', 100, 10, 100)).toBe(100)
  })
})

describe('isMobileUserAgent (D-055 fallback)', () => {
  test('phones and tablets yes, desktops no', async () => {
    const { isMobileUserAgent } = await import('../src/capture.ts')
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36')).toBe(true)
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148')).toBe(true)
    expect(isMobileUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36')).toBe(false)
    expect(isMobileUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe(false)
  })
})

describe('speakerOf (D-057)', () => {
  test('the chosen viewer when seated; otherwise everyone', async () => {
    const { speakerOf } = await import('../src/capture.ts')
    const seated = [{ id: 'c1' }, { id: 'council:w' }]
    expect(speakerOf({ chat1: 'council:w' }, 'chat1', seated)).toBe('council:w')
    expect(speakerOf({ chat1: 'gone' }, 'chat1', seated)).toBeNull()
    expect(speakerOf({ other: 'c1' }, 'chat1', seated)).toBeNull()
    expect(speakerOf(undefined, 'chat1', seated)).toBeNull()
  })
})

describe('Look things up is the chat\'s own switch, for every stance (D18″)', () => {
  test('a chat that has it on gets notes whatever the stance', () => {
    for (const stance of ['heckler', 'coach', 'character', 'custom'] as const) expect(chatLooksUp(true, false, stance)).toBe(true)
  })
  test('a chat that has it off gets none, even where the old shared switch was on', () => {
    for (const stance of ['heckler', 'coach', 'character', 'custom'] as const) expect(chatLooksUp(false, true, stance)).toBe(false)
  })
  test('a chat never asked keeps what it had: the old shared switch, for Coach and Custom only', () => {
    expect(chatLooksUp(undefined, true, 'coach')).toBe(true)
    expect(chatLooksUp(undefined, true, 'custom')).toBe(true)
    expect(chatLooksUp(undefined, true, 'heckler')).toBe(false)
    expect(chatLooksUp(undefined, true, 'character')).toBe(false)
  })
  test('off by default: never asked, and no old switch', () => {
    for (const stance of ['heckler', 'coach', 'character', 'custom'] as const) expect(chatLooksUp(undefined, false, stance)).toBe(false)
  })
})

describe('D-099: what the strip and the toolbar say', () => {
  test('Watching: the name, a question mark while a question is open, nothing otherwise', async () => {
    const { watchingLine } = await import('../src/capture.ts')
    expect(watchingLine({ confirmed: 'Palworld', candidate: null })).toBe('Watching: Palworld')
    expect(watchingLine({ confirmed: null, candidate: null, lastConfirmed: 'Palworld', doubt: 'screen' })).toBe('Watching: ?')
    expect(watchingLine({ confirmed: null, candidate: { text: 'Blender', source: 'vision', confidence: 0.8 } })).toBe('Watching: ?')
    expect(watchingLine({ confirmed: null, candidate: null })).toBe('')
  })

  test('the stop warning: the last two minutes, or the last half of a short session', async () => {
    const { stopWarningMs, stopWarningText } = await import('../src/capture.ts')
    expect(stopWarningMs(30 * 60_000)).toBe(120_000)
    expect(stopWarningMs(4 * 60_000)).toBe(120_000)
    expect(stopWarningMs(2 * 60_000)).toBe(60_000)
    expect(stopWarningMs(60_000)).toBe(30_000)
    const stop = 10_000_000
    const warnAt = stop - 120_000
    expect(stopWarningText(stop, warnAt, warnAt - 1)).toBe('')
    expect(stopWarningText(stop, warnAt, warnAt)).toBe('Stops in 2:00')
    expect(stopWarningText(stop, warnAt, stop - 102_000)).toBe('Stops in 1:42')
    expect(stopWarningText(stop, warnAt, stop - 500)).toBe('Stops in 0:01')
    expect(stopWarningText(stop, warnAt, stop)).toBe('')
    expect(stopWarningText(null, null, 5)).toBe('')
  })
})
