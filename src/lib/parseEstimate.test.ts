import { describe, expect, it } from 'vitest'
import { formatItemQuantity, parseEstimateResponse } from './parseEstimate'

describe('parseEstimateResponse', () => {
  const validItem = { name: 'Rice', calories: 200, protein_g: 4, carbs_g: 45, fat_g: 0.5 }
  const valid = {
    items: [validItem],
    calories: 542.4,
    protein_g: 30.1,
    carbs_g: 60.9,
    fat_g: 12.2,
    confidence: 'medium',
  }

  it('parses and rounds a valid response including items (old format → new fields empty)', () => {
    const result = parseEstimateResponse(valid)
    expect(result).toEqual({
      items: [{ name: 'Rice', quantity: null, grams: null, calories: 200, protein_g: 4, carbs_g: 45, fat_g: 1, confidence: null }],
      calories: 542,
      protein_g: 30,
      carbs_g: 61,
      fat_g: 12,
      confidence: 'medium',
      assumptions: [],
    })
  })

  it('parses quantity, grams, per-item confidence and assumptions from the v2 prompt', () => {
    const result = parseEstimateResponse({
      ...valid,
      items: [{ ...validItem, name: ' White rice ', quantity: ' 1 cup cooked ', grams: 152.4, confidence: 'high' }],
      assumptions: ['Assumed 1 tsp oil', '', 42, 'Curry could be prawn', 'third', 'fourth'],
    })!
    expect(result.items[0]).toMatchObject({ name: 'White rice', quantity: '1 cup cooked', grams: 152, confidence: 'high' })
    expect(result.assumptions).toEqual(['Assumed 1 tsp oil', 'Curry could be prawn', 'third'])
  })

  it('ignores junk quantity / grams / confidence without dropping the item', () => {
    const result = parseEstimateResponse({
      ...valid,
      items: [{ ...validItem, quantity: '   ', grams: -5, confidence: 'certain' }],
    })!
    expect(result.items[0]).toMatchObject({ quantity: null, grams: null, confidence: null })
  })

  it('flags a non-food photo with the AI\'s reason', () => {
    const result = parseEstimateResponse({ ...valid, items: [], is_food: false, not_food_reason: ' Looks like a lip balm ' })!
    expect(result.notFood).toBe('Looks like a lip balm')
    expect(parseEstimateResponse({ ...valid, is_food: false })!.notFood).toBe('This doesn’t look like food')
    expect(parseEstimateResponse({ ...valid, is_food: true })!.notFood).toBeUndefined()
  })

  it('returns empty items array when items field is absent', () => {
    const { items: _items, ...noItems } = valid
    const result = parseEstimateResponse(noItems)
    expect(result).not.toBeNull()
    expect(result!.items).toEqual([])
  })

  it('skips malformed items but keeps well-formed ones', () => {
    const raw = {
      ...valid,
      items: [
        validItem,
        { name: 'Bad', calories: 'oops', protein_g: 4, carbs_g: 20, fat_g: 2 }, // bad
        { name: 'Good', calories: 100, protein_g: 5, carbs_g: 10, fat_g: 3 },
      ],
    }
    const result = parseEstimateResponse(raw)
    expect(result).not.toBeNull()
    expect(result!.items).toHaveLength(2)
    expect(result!.items[0].name).toBe('Rice')
    expect(result!.items[1].name).toBe('Good')
  })

  it('returns null when a top-level required field is missing', () => {
    const { calories: _calories, ...rest } = valid
    expect(parseEstimateResponse(rest)).toBeNull()
  })

  it('returns null when a numeric field has the wrong type', () => {
    expect(parseEstimateResponse({ ...valid, calories: '542' })).toBeNull()
  })

  it('returns null for a negative top-level value', () => {
    expect(parseEstimateResponse({ ...valid, protein_g: -5 })).toBeNull()
  })

  it('returns null for an invalid confidence string', () => {
    expect(parseEstimateResponse({ ...valid, confidence: 'very high' })).toBeNull()
  })

  it('returns null for null input', () => {
    expect(parseEstimateResponse(null)).toBeNull()
  })

  it('returns null for a non-object input', () => {
    expect(parseEstimateResponse('not an object')).toBeNull()
  })
})

describe('formatItemQuantity', () => {
  it('joins the household measure and grams', () => {
    expect(formatItemQuantity({ quantity: '1 cup cooked', grams: 150 })).toBe('1 cup cooked · ~150 g')
  })
  it('does not repeat grams already in the text', () => {
    expect(formatItemQuantity({ quantity: '150 g', grams: 150 })).toBe('150 g')
  })
  it('falls back to whichever part exists', () => {
    expect(formatItemQuantity({ quantity: null, grams: 90 })).toBe('~90 g')
    expect(formatItemQuantity({ quantity: '2 eggs', grams: null })).toBe('2 eggs')
    expect(formatItemQuantity({ quantity: null, grams: null })).toBeNull()
  })
})
