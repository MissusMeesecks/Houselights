import { describe, expect, test } from 'bun:test'
import { nameWords, sameGame, significantWords } from '../src/names'

describe('sameGame (Watching chip)', () => {
  test('the same title spelled differently', () => {
    expect(sameGame('Borderlands 2', 'borderlands-2')).toBe(true)
    expect(sameGame('Borderlands 2', 'Borderlands 2: GOTY')).toBe(true)
    expect(sameGame('Borderlands 2', 'Borderlands 2 (Gaige)')).toBe(true)
    expect(sameGame('Borderlands 2', 'Borderlands')).toBe(true)
    expect(sameGame("Assassin's Creed IV: Black Flag", "Assassin's Creed Black Flag")).toBe(true)
    expect(sameGame("Assassin's Creed IV: Black Flag", 'Assassins Creed 4: Black Flag')).toBe(true)
    expect(sameGame("Assassin's Creed IV: Black Flag", 'Assassin’s Creed IV Black Flag')).toBe(true)
  })

  test('abbreviations the user typed', () => {
    expect(sameGame('AC: Black Flag', "Assassin's Creed IV: Black Flag")).toBe(true)
    expect(sameGame('AC4 Black Flag', "Assassin's Creed IV: Black Flag")).toBe(true)
    expect(sameGame('Black Flag', "Assassin's Creed IV: Black Flag")).toBe(true)
    expect(sameGame('BL2', 'Borderlands 2')).toBe(false) // nothing to match on; we don't guess that far
  })

  test('a subtitle, a numeral or a plural never makes a new game', () => {
    expect(sameGame('The Witcher 3: Wild Hunt', 'The Witcher 3')).toBe(true)
    expect(sameGame('Witcher III Wild Hunt', 'The Witcher 3: Wild Hunt - Complete Edition')).toBe(true)
    expect(sameGame('Going Medieval', 'Going Medieval (early access)')).toBe(true)
  })

  test('different games stay different', () => {
    expect(sameGame("Assassin's Creed IV: Black Flag", 'Call of Duty: Black Ops')).toBe(false)
    expect(sameGame('Going Medieval', 'Medieval Dynasty')).toBe(false)
    expect(sameGame('Discord', 'Borderlands 2')).toBe(false)
    expect(sameGame('Excel', 'Borderlands 2')).toBe(false)
    expect(sameGame('Black Flag', 'Black Ops')).toBe(false)
    expect(sameGame('Firefox', 'Fire Emblem')).toBe(false)
  })

  test('the same franchise counts as the same (two shared identifying words)', () => {
    expect(sameGame('Call of Duty: Black Ops', 'Call of Duty: Warzone')).toBe(true)
  })

  test('empty and null', () => {
    expect(sameGame(null, 'Borderlands 2')).toBe(false)
    expect(sameGame('', 'Borderlands 2')).toBe(false)
    expect(sameGame('---', 'Borderlands 2')).toBe(false)
  })

  test('word helpers', () => {
    expect(nameWords("Assassin's Creed IV: Black Flag")).toEqual(['assassin', 'creed', 'iv', 'black', 'flag'])
    expect(significantWords('Borderlands 2: Game of the Year Edition')).toEqual(['borderland'])
  })
})
