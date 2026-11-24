import { describe, expect, test } from 'bun:test'
import { decorOf } from '../src/beat-decorator.ts'

describe('decorOf: what gets drawn on a message', () => {
  test('a beat with a thumbnail draws the picture', () => {
    expect(decorOf({ houselights: { beat: true, thumbB64: 'abc', width: 10, height: 10 } })).toMatchObject({ kind: 'beat' })
  })
  test('a beat without a thumbnail draws nothing', () => {
    expect(decorOf({ houselights: { beat: true } })).toBeNull()
  })
  test('a council line draws the member portrait, with their name', () => {
    expect(decorOf({ houselights: { reaction: true, box: true, speaker: 'Ottilie', speakerAvatar: '/api/v1/images/a' } })).toEqual({
      kind: 'portrait',
      url: '/api/v1/images/a',
      name: 'Ottilie',
    })
  })
  test('a card line (no speakerAvatar) and foreign metadata draw nothing', () => {
    expect(decorOf({ houselights: { reaction: true, box: true, speaker: 'Marlo' } })).toBeNull()
    expect(decorOf({ other: { speakerAvatar: '/x' } })).toBeNull()
    expect(decorOf(null)).toBeNull()
  })
})
