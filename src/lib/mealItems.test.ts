import { describe, expect, it } from 'vitest'
import { foodEmoji, itemsForPost, postedItems } from './mealItems'

const item = (name: string, calories: number) => ({ name, quantity: null, grams: 100, calories, protein_g: 10, carbs_g: 5, fat_g: 2, confidence: null })
const ai = (items: unknown[]) => ({ calories: 400, protein_g: 30, carbs_g: 20, fat_g: 10, confidence: 'high', items })

describe('postedItems', () => {
  it('prefers the saved items', () => {
    const log = { items: [item('Chicken', 300), item('Curd', 100)], ai_raw_response: ai([item('Old', 400)]), calories_final: 400, calories_estimate: 400 }
    expect(postedItems(log).map((i) => i.name)).toEqual(['Chicken', 'Curd'])
  })
  it('falls back to the AI items on older posts', () => {
    const log = { ai_raw_response: ai([item('Rice', 250), item('Dal', 150)]), calories_final: 400, calories_estimate: 400 }
    expect(postedItems(log)).toHaveLength(2)
  })
  it('hides items that no longer add up to the posted calories', () => {
    const log = { ai_raw_response: ai([item('Rice', 250), item('Dal', 150)]), calories_final: 600, calories_estimate: 400 }
    expect(postedItems(log)).toEqual([])
  })
  it('hides items whose protein doesn’t match the post (30 g posted, item says 27 g)', () => {
    const whey = { ...item('Whey isolate', 120), protein_g: 27, carbs_g: 2, fat_g: 1 }
    const log = { items: [whey], ai_raw_response: null, calories_final: 120, calories_estimate: 120, protein_final_g: 30, carbs_final_g: 2, fat_final_g: 1 }
    expect(postedItems(log)).toEqual([])
    expect(postedItems({ ...log, protein_final_g: 27 })).toHaveLength(1)
  })
  it('handles posts with no items', () => {
    expect(postedItems({ ai_raw_response: null, calories_final: 300, calories_estimate: null })).toEqual([])
  })
})

describe('itemsForPost', () => {
  it('scales items by the portion', () => {
    const [i] = itemsForPost([item('Rice', 200)], 1.5)!
    expect(i).toMatchObject({ calories: 300, protein_g: 15, grams: 150 })
  })
  it('is null with no items', () => expect(itemsForPost([], 1)).toBeNull())
})

describe('foodEmoji', () => {
  it('matches common foods', () => {
    expect(foodEmoji('Chicken curry')).toBe('🍗')
    expect(foodEmoji('Grey Goose Vodka')).toBe('🍸')
    expect(foodEmoji('Kingfisher beer')).toBe('🍺')
    expect(foodEmoji('Rumali roti')).toBe('🫓')
    expect(foodEmoji('Steamed rice')).toBe('🍚')
    expect(foodEmoji('Curd')).toBe('🥣')
    expect(foodEmoji('Mystery')).toBe('🍽️')
  })
})
